#include "audio_engine.hpp"

#ifdef _WIN32
#include <winsock2.h>
#else
#include <netinet/in.h>
#endif

#include <aoo.h>
#include <aoo_sink.hpp>
#include <aoo_source.hpp>
#include <codec/aoo_opus.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>

#if AOO_NET
#error This experiment requires AOO_NET=OFF: no AoO discovery, relay or socket runtime.
#endif

namespace native_audio {
namespace {
constexpr AooId endpointId = 1;
constexpr int codecFrames = 960; // 20 ms at 48 kHz, independently of the 10 ms callback.

void checked(AooError result, const char* action) {
    if (result != kAooOk) {
        throw std::runtime_error(std::string(action) + ": " + aoo_strerror(result));
    }
}

struct Runtime {
    Runtime() {
        AooSettings settings;
        settings.memPoolSize = 8 * 1024 * 1024;
        checked(aoo_initialize(&settings), "aoo_initialize");
    }
    ~Runtime() { aoo_terminate(); }
};

void ensureRuntime() {
    // Initialization/destruction are outside audio callbacks. AoO's initializer
    // itself is not thread safe, so C++ static initialization serializes it.
    static Runtime runtime;
    (void)runtime;
}

sockaddr_in socketAddress(PeerAddress address) noexcept {
    sockaddr_in result{};
    result.sin_family = AF_INET;
    result.sin_addr.s_addr = htonl(address.ipv4);
    result.sin_port = htons(address.port);
    return result;
}

std::uint32_t read32(const std::uint8_t* value) noexcept {
    return (static_cast<std::uint32_t>(value[0]) << 24) |
           (static_cast<std::uint32_t>(value[1]) << 16) |
           (static_cast<std::uint32_t>(value[2]) << 8) | value[3];
}

// A bounded OSC envelope check constrains identity and allocation-driving
// fields before invoking AoO's own complete protocol/codec parser. This core
// deliberately uses OSC (binary off) to keep the fixed peer/source limit true
// even for malformed packets from an authenticated transport peer.
struct OscEnvelope {
    struct Argument { char type{}; const std::uint8_t* data{}; std::size_t size{}; };
    std::array<Argument, 32> arguments{};
    std::size_t count{};
    const char* pattern{};

    bool parse(const std::uint8_t* bytes, std::size_t size) noexcept {
        if (size < 12 || bytes[0] != '/' || size % 4 != 0) return false;
        std::size_t cursor = 0;
        auto string = [&](const std::uint8_t*& value, std::size_t& length) {
            const std::size_t start = cursor;
            while (cursor < size && bytes[cursor] != 0) ++cursor;
            if (cursor == size) return false;
            value = bytes + start;
            length = cursor - start;
            cursor = (cursor + 4) & ~std::size_t(3);
            return cursor <= size;
        };
        const std::uint8_t* address;
        std::size_t addressLength;
        if (!string(address, addressLength)) return false;
        pattern = reinterpret_cast<const char*>(address);
        const std::uint8_t* tags;
        std::size_t tagsLength;
        if (!string(tags, tagsLength) || tagsLength < 2 || tags[0] != ',' ||
            tagsLength - 1 > arguments.size()) return false;
        count = tagsLength - 1;
        for (std::size_t index = 0; index < count; ++index) {
            auto& arg = arguments[index];
            arg.type = static_cast<char>(tags[index + 1]);
            arg.data = bytes + cursor;
            switch (arg.type) {
            case 'i': case 'f': arg.size = 4; break;
            case 'h': case 'd': case 't': arg.size = 8; break;
            case 'N': case 'T': case 'F': case 'I': arg.size = 0; break;
            case 's': {
                if (!string(arg.data, arg.size)) return false;
                continue;
            }
            case 'b': {
                if (size - cursor < 4) return false;
                const auto length = read32(bytes + cursor);
                cursor += 4;
                if (length > size - cursor) return false;
                arg.data = bytes + cursor;
                arg.size = length;
                cursor += (static_cast<std::size_t>(length) + 3) & ~std::size_t(3);
                if (cursor > size) return false;
                continue;
            }
            default: return false;
            }
            if (arg.size > size - cursor) return false;
            cursor += arg.size;
        }
        return cursor == size && integer(0, 1, 1);
    }

    bool integer(std::size_t index, std::uint32_t minimum,
                 std::uint32_t maximum) const noexcept {
        return index < count && arguments[index].type == 'i' &&
               read32(arguments[index].data) >= minimum &&
               read32(arguments[index].data) <= maximum;
    }

    bool boundedStream(AooMsgType type) const noexcept {
        if (type != kAooMsgTypeSink) return true;
        if (std::strcmp(pattern, "/aoo/sink/1/start") == 0) {
            return integer(5, 1, 1) && integer(6, 48000, 48000) &&
                   integer(7, codecFrames, codecFrames) && count > 9 &&
                   arguments[8].type == 's' && arguments[8].size == 4 &&
                   std::memcmp(arguments[8].data, "opus", 4) == 0 &&
                   arguments[9].type == 'b' && arguments[9].size <= 64;
        }
        if (std::strcmp(pattern, "/aoo/sink/1/data") == 0) {
            return integer(5, 0, 0) && integer(6, 0, Engine::maxPacketBytes) &&
                   count == 11 && arguments[7].type == 'N' &&
                   ((arguments[8].type == 'N' && arguments[9].type == 'N') ||
                    (integer(8, 1, 4) && integer(9, 0, 3)));
        }
        return true;
    }
};

bool normalResult(AooError result) noexcept {
    return result == kAooOk || result == kAooErrorIdle || result == kAooErrorWouldBlock;
}
} // namespace

struct Engine::Impl {
    EngineOptions options;
    AooSource::Ptr source;
    AooSink::Ptr sink;
    std::array<PeerAddress, maxPeers> peers{};
    std::array<sockaddr_in, maxPeers> addresses{};
    std::uint32_t peerCount{};
    std::atomic<bool> started{false};
    std::array<float, 480> input{};
    std::atomic<std::uint64_t> processCalls{0}, inputFrames{0}, outputActiveFrames{0};
    std::atomic<std::uint64_t> packetsSent{0}, bytesSent{0}, packetsReceived{0}, bytesReceived{0};
    std::atomic<std::uint64_t> rejectedPackets{0}, processErrors{0}, clippedSamples{0};

    explicit Impl(const EngineOptions& value) : options(value) {
        if (options.sampleRate != 48000 || options.blockFrames != 480 ||
            (options.bitrate != 24000 && options.bitrate != 32000 &&
             options.bitrate != 48000 && options.bitrate != 64000) ||
            !std::isfinite(options.bufferSeconds) || options.bufferSeconds < 0.020 ||
            options.bufferSeconds > 0.500) {
            throw std::invalid_argument("expected 48 kHz mono/480 callback frames, 24/32/48/64 kbps and 20-500 ms buffer");
        }
        ensureRuntime();
        source = AooSource::create(endpointId);
        sink = AooSink::create(endpointId);
        if (!source || !sink) throw std::runtime_error("AoO endpoint allocation failed");
        checked(source->setup(1, 48000, options.blockFrames, kAooFixedBlockSize), "source setup");
        checked(sink->setup(1, 48000, options.blockFrames, kAooFixedBlockSize), "sink setup");
        checked(source->setEventHandler(nullptr, nullptr, kAooEventModeNone), "disable source event queue");
        checked(sink->setEventHandler(nullptr, nullptr, kAooEventModeNone), "disable sink event queue");
        AooFormatOpus format;
        AooFormatOpus_init(&format, 1, 48000, codecFrames, OPUS_APPLICATION_VOIP);
        checked(source->setFormat(format.header), "Opus VOIP format");
        checked(AooSource_setOpusBitrate(source.get(), nullptr, options.bitrate), "Opus bitrate");
        checked(AooSource_setOpusSignalType(source.get(), nullptr, OPUS_SIGNAL_VOICE), "Opus voice signal");
        checked(source->setBufferSize(0.100), "bounded source queue");
        checked(source->setResendBufferSize(0.250), "bounded resend history");
        checked(source->setPacketSize(1200), "bounded datagram");
        checked(source->setDynamicResampling(kAooTrue), "source clock compensation");
        checked(sink->setDynamicResampling(kAooTrue), "sink clock compensation");
        checked(source->setBinaryFormat(kAooFalse), "source OSC mode");
        checked(sink->setBinaryFormat(kAooFalse), "sink OSC mode");
        checked(sink->setLatency(options.bufferSeconds), "initial jitter latency");
        checked(sink->setBufferSize(std::max(0.300, options.bufferSeconds * 2)), "bounded sink queue");
        checked(sink->setResendLimit(4), "bounded resend requests");
        checked(sink->setResendInterval(0.020), "resend interval");
        checked(sink->setSourceTimeout(5.0), "source timeout");
        checked(source->startStream(0, nullptr), "start stream");
        // pre4's Opus wrapper exposes bitrate/complexity/signal controls only.
        // Its opus_multistream_encoder_init defaults leave FEC and DTX off;
        // we never claim to enable controls that this wrapper cannot forward.
    }

    bool known(PeerAddress address) const noexcept {
        for (std::uint32_t index = 0; index < peerCount; ++index) {
            if (peers[index] == address) return true;
        }
        return false;
    }

    struct Sending { Impl* impl; PacketCallback callback; void* context; bool failed = false; };
    static AooInt32 AOO_CALL emit(void* user, const AooByte* data, AooInt32 size,
                                 const void* address, AooAddrSize addressSize, AooFlag) noexcept {
        auto& sending = *static_cast<Sending*>(user);
        if (!address || addressSize != sizeof(sockaddr_in) || size <= 0 ||
            static_cast<std::size_t>(size) > maxPacketBytes) {
            sending.failed = true;
            return -1;
        }
        const auto& ipv4 = *static_cast<const sockaddr_in*>(address);
        PeerAddress destination{ntohl(ipv4.sin_addr.s_addr), ntohs(ipv4.sin_port)};
        if (ipv4.sin_family != AF_INET || !sending.impl->known(destination)) {
            sending.failed = true;
            return -1;
        }
        bool accepted = false;
        try { accepted = sending.callback(sending.context, data, static_cast<std::size_t>(size), destination); }
        catch (...) { accepted = false; }
        if (!accepted) { sending.failed = true; return -1; }
        sending.impl->packetsSent.fetch_add(1, std::memory_order_relaxed);
        sending.impl->bytesSent.fetch_add(size, std::memory_order_relaxed);
        return size;
    }
};

Engine::Engine(const EngineOptions& options) : impl_(std::make_unique<Impl>(options)) {}
Engine::~Engine() = default;

bool Engine::addPeer(PeerAddress address) {
    auto& impl = *impl_;
    if (impl.started.load(std::memory_order_relaxed) || address.ipv4 == 0 || address.port == 0 ||
        (address.ipv4 >> 24) >= 224 || impl.peerCount >= maxPeers || impl.known(address)) return false;
    const auto index = impl.peerCount;
    impl.addresses[index] = socketAddress(address);
    const AooEndpoint endpoint{&impl.addresses[index], sizeof(sockaddr_in), endpointId};
    if (impl.source->addSink(endpoint, kAooTrue) != kAooOk) return false;
    impl.peers[index] = address;
    ++impl.peerCount;
    return true;
}

bool Engine::process(const float* input, float* output, int frames, std::uint64_t ntp) noexcept {
    auto& impl = *impl_;
    impl.started.store(true, std::memory_order_relaxed);
    if (!input || !output || frames != impl.options.blockFrames || ntp == 0) {
        impl.processErrors.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    std::fill(output, output + frames, 0.0f);
    for (int index = 0; index < frames; ++index) {
        if (!std::isfinite(input[index])) {
            impl.processErrors.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        impl.input[index] = std::clamp(input[index], -1.0f, 1.0f);
    }
    AooSample* inputChannels[] = {impl.input.data()};
    AooSample* outputChannels[] = {output};
    const auto sourceResult = impl.source->process(inputChannels, frames, ntp);
    const auto sinkResult = impl.sink->process(outputChannels, frames, ntp, nullptr, nullptr);
    std::uint64_t active = 0, clipped = 0;
    for (int index = 0; index < frames; ++index) {
        auto& sample = output[index];
        if (!std::isfinite(sample)) sample = 0.0f;
        if (std::abs(sample) > 1.0f) { sample = std::clamp(sample, -1.0f, 1.0f); ++clipped; }
        if (std::abs(sample) > 0.0001f) ++active;
    }
    impl.processCalls.fetch_add(1, std::memory_order_relaxed);
    impl.inputFrames.fetch_add(frames, std::memory_order_relaxed);
    impl.outputActiveFrames.fetch_add(active, std::memory_order_relaxed);
    impl.clippedSamples.fetch_add(clipped, std::memory_order_relaxed);
    if (!normalResult(sourceResult) || !normalResult(sinkResult)) {
        impl.processErrors.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    return true;
}

bool Engine::receive(const std::uint8_t* bytes, std::size_t size, PeerAddress from) noexcept {
    auto& impl = *impl_;
    impl.started.store(true, std::memory_order_relaxed);
    auto reject = [&] { impl.rejectedPackets.fetch_add(1, std::memory_order_relaxed); return false; };
    if (!bytes || size == 0 || size > maxPacketBytes || !impl.known(from)) return reject();
    OscEnvelope envelope;
    if (!envelope.parse(bytes, size)) return reject();
    AooMsgType type;
    AooId id;
    AooInt32 offset;
    if (aoo_parsePattern(bytes, static_cast<AooInt32>(size), &type, &id, &offset) != kAooOk ||
        id != endpointId || !envelope.boundedStream(type)) return reject();
    const auto address = socketAddress(from);
    AooError result;
    if (type == kAooMsgTypeSource) {
        result = impl.source->handleMessage(bytes, static_cast<AooInt32>(size), &address, sizeof(address));
    } else if (type == kAooMsgTypeSink) {
        result = impl.sink->handleMessage(bytes, static_cast<AooInt32>(size), &address, sizeof(address));
    } else return reject();
    // A ping may overtake the first stream-start packet. AoO reports NotFound
    // for this harmless ordering; it is not a malformed datagram or a reason
    // for the transport to terminate the voice session.
    const bool earlyPing = result == kAooErrorNotFound &&
        (std::strstr(envelope.pattern, "/ping") || std::strstr(envelope.pattern, "/pong"));
    if (result != kAooOk && !earlyPing) return reject();
    impl.packetsReceived.fetch_add(1, std::memory_order_relaxed);
    impl.bytesReceived.fetch_add(size, std::memory_order_relaxed);
    return true;
}

bool Engine::send(PacketCallback callback, void* context) noexcept {
    auto& impl = *impl_;
    impl.started.store(true, std::memory_order_relaxed);
    if (!callback) return false;
    Impl::Sending sending{&impl, callback, context};
    const auto sourceResult = impl.source->send(Impl::emit, &sending);
    const auto sinkResult = impl.sink->send(Impl::emit, &sending);
    return !sending.failed && normalResult(sourceResult) && normalResult(sinkResult);
}

EngineStats Engine::stats() const noexcept {
    const auto& impl = *impl_;
    EngineStats result;
#define SNAPSHOT(field) result.field = impl.field.load(std::memory_order_relaxed)
    SNAPSHOT(processCalls); SNAPSHOT(inputFrames); SNAPSHOT(outputActiveFrames);
    SNAPSHOT(packetsSent); SNAPSHOT(bytesSent); SNAPSHOT(packetsReceived); SNAPSHOT(bytesReceived);
    SNAPSHOT(rejectedPackets); SNAPSHOT(processErrors); SNAPSHOT(clippedSamples);
#undef SNAPSHOT
    result.peers = impl.peerCount;
    return result;
}

const EngineOptions& Engine::options() const noexcept { return impl_->options; }
} // namespace native_audio
