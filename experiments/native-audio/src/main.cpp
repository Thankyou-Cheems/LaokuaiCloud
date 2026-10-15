#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mswsock.h>
#include <windows.h>
#include <bcrypt.h>
#include <conio.h>
#include <portaudio.h>

#include "audio_engine.hpp"
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

// This experiment owns only its UDP socket and PortAudio stream. EasyTier,
// account credentials, TUN, services and firewall rules are outside this host.
namespace {
using native_audio::Engine;
using native_audio::PeerAddress;
constexpr std::size_t headerBytes = 52;
constexpr std::size_t tagBytes = 32;
constexpr std::size_t maxWireBytes = headerBytes + Engine::maxPacketBytes + tagBytes;
constexpr std::uint64_t freshnessMs = 30000;

std::uint64_t unixMillis() noexcept {
    return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count());
}
std::uint64_t ntpNow() noexcept {
    const auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    return (static_cast<std::uint64_t>(ns / 1000000000 + 2208988800LL) << 32) |
        (static_cast<std::uint64_t>(ns % 1000000000) * 4294967296ULL / 1000000000ULL);
}
void event(const char* name) { std::cout << "{\"event\":\"" << name << "\"}\n" << std::flush; }
void error(const char* code) {
    std::cout << "{\"event\":\"error\",\"code\":\"" << code << "\"}\n" << std::flush;
}
std::string jsonString(const char* source) {
    std::ostringstream out;
    out << '"';
    for (const auto* p = reinterpret_cast<const unsigned char*>(source); *p; ++p) {
        switch (*p) {
        case '"': out << "\\\""; break;
        case '\\': out << "\\\\"; break;
        case '\n': out << "\\n"; break;
        case '\r': out << "\\r"; break;
        case '\t': out << "\\t"; break;
        default:
            if (*p < 32) {
                const char hex[] = "0123456789abcdef";
                out << "\\u00" << hex[*p >> 4] << hex[*p & 15];
            } else { out << static_cast<char>(*p); }
        }
    }
    out << '"';
    return out.str();
}

bool decimal(const std::string& value, unsigned& result, unsigned maximum) {
    if (value.empty() || value.size() > 5) return false;
    result = 0;
    for (const char c : value) {
        if (c < '0' || c > '9') return false;
        result = result * 10 + static_cast<unsigned>(c - '0');
        if (result > maximum) return false;
    }
    return true;
}
bool ipv4(const std::string& text, std::uint32_t& result) {
    result = 0;
    std::size_t start = 0;
    for (unsigned i = 0; i < 4; ++i) {
        const auto end = text.find('.', start);
        if ((i < 3 && end == std::string::npos) || (i == 3 && end != std::string::npos)) return false;
        const auto part = text.substr(start, end == std::string::npos ? end : end - start);
        unsigned octet = 0;
        if (part.size() > 3 || (part.size() > 1 && part.front() == '0') || !decimal(part, octet, 255)) return false;
        result = (result << 8) | octet;
        start = end + 1;
    }
    return true;
}
bool permitted(std::uint32_t address, bool loopback) noexcept {
    return loopback ? address == 0x7f000001U :
        ((address & 0xffffff00U) == 0x0acbd900U && (address & 255) != 0 && (address & 255) != 255);
}
bool deviceIndex(const std::string& value, int& index) {
    if (value == "-1") { index = -1; return true; }
    unsigned parsed = 0;
    if (!decimal(value, parsed, 65535)) return false;
    index = static_cast<int>(parsed);
    return true;
}
bool gainValue(const std::string& value, float& gain) {
    if (value.empty() || value.size() > 16 || value.find_first_not_of("0123456789.") != std::string::npos) return false;
    std::istringstream input(value);
    return bool(input >> gain) && input.eof() && std::isfinite(gain) && gain >= 0.f && gain <= 2.f;
}
int hexDigit(char c) noexcept {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}
struct Config {
    PeerAddress local;
    std::vector<PeerAddress> peers;
    std::vector<float> peerGains;
    std::vector<bool> canPublish, canReceive;
    std::array<std::uint8_t, 32> key{};
    int input = -1;
    int output = -1;
    bool muted = false, deafened = false;
    float inputGain = 1.f, outputGain = 1.f;
    ~Config() { SecureZeroMemory(key.data(), key.size()); }
};

// Read directly from the handle so a buffered iostream cannot consume future
// commands before the nonblocking control loop sees them. Limits apply even to
// malformed input; secrets are never interpolated into diagnostics.
class Input {
public:
    bool line(std::string& result) {
        result.clear();
        result.reserve(2048); // A secret line must not leave copies on reallocation.
        char c;
        DWORD read = 0;
        while (ReadFile(handle_, &c, 1, &read, nullptr) && read == 1) {
            if (c == '\n') return true;
            if (c == '\r') continue;
            if (result.size() >= 2048) { SecureZeroMemory(result.data(), result.size()); return false; }
            result.push_back(c);
        }
        if (!result.empty()) SecureZeroMemory(result.data(), result.size());
        return false;
    }
    // 1 complete command, 0 pending, -1 EOF/invalid input.
    int poll(std::string& command) {
        const DWORD type = GetFileType(handle_);
        for (unsigned n = 0; n < 256; ++n) {
            char c = 0;
            if (type == FILE_TYPE_CHAR) {
                if (!_kbhit()) return 0;
                const int key = _getch();
                if (key == 0 || key == 224) { if (_kbhit()) (void)_getch(); continue; }
                c = static_cast<char>(key);
                if (c == '\r') c = '\n';
            } else {
                if (type == FILE_TYPE_PIPE) {
                    DWORD available = 0;
                    if (!PeekNamedPipe(handle_, nullptr, 0, nullptr, &available, nullptr)) return -1;
                    if (!available) return 0;
                }
                DWORD read = 0;
                if (!ReadFile(handle_, &c, 1, &read, nullptr) || read != 1) return -1;
            }
            if (c == '\n') { command.swap(pending_); pending_.clear(); return 1; }
            if (c == '\r') continue;
            if (pending_.size() >= 128) return -1;
            pending_.push_back(c);
        }
        return 0;
    }
private:
    HANDLE handle_ = GetStdHandle(STD_INPUT_HANDLE);
    std::string pending_;
};

template<class ReadLine>
bool parseFields(ReadLine readLine, Config& cfg, bool loopback) {
    std::string value;
    if (!readLine(value) || value != "LAOKUAI_NATIVE_AUDIO_V1") return false;
    if (!readLine(value) || !ipv4(value, cfg.local.ipv4) || !permitted(cfg.local.ipv4, loopback)) return false;
    unsigned port = 0;
    if (!readLine(value) || !decimal(value, port, 65535) || port < 1024) return false;
    cfg.local.port = static_cast<std::uint16_t>(port);
    if (!readLine(value)) return false;
    std::size_t start = 0;
    while (start < value.size()) {
        const auto comma = value.find(',', start);
        const auto peerText = value.substr(start, comma == std::string::npos ? comma : comma - start);
        const auto colon = peerText.find(':');
        PeerAddress peer;
        if (colon == std::string::npos || !ipv4(peerText.substr(0, colon), peer.ipv4) ||
            !permitted(peer.ipv4, loopback) || !decimal(peerText.substr(colon + 1), port, 65535) || port < 1024) return false;
        peer.port = static_cast<std::uint16_t>(port);
        if (peer == cfg.local || std::find(cfg.peers.begin(), cfg.peers.end(), peer) != cfg.peers.end() ||
            cfg.peers.size() >= Engine::maxPeers) return false;
        cfg.peers.push_back(peer);
        if (comma == std::string::npos) break;
        start = comma + 1;
        if (start == value.size()) return false;
    }
    if (!readLine(value)) return false;
    bool validKey = value.size() == 64;
    if (validKey) {
        for (std::size_t i = 0; i < cfg.key.size(); ++i) {
            const int high = hexDigit(value[i * 2]);
            const int low = hexDigit(value[i * 2 + 1]);
            if (high < 0 || low < 0) { validKey = false; break; }
            cfg.key[i] = static_cast<std::uint8_t>((high << 4) | low);
        }
    }
    if (!value.empty()) SecureZeroMemory(value.data(), value.size());
    value.clear();
    if (!validKey || std::all_of(cfg.key.begin(), cfg.key.end(), [](auto b) { return b == 0; })) return false;
    if (!readLine(value) || value != "duplex") return false;
    if (!readLine(value) || !deviceIndex(value, cfg.input)) return false;
    if (!readLine(value) || !deviceIndex(value, cfg.output)) return false;
    if (!readLine(value)) return false;
    if (value == "start") return true;
    std::istringstream controls(value);
    std::string startCommand, muted, deafened, inGain, outGain, peerControls, extra;
    if (!(controls >> startCommand >> muted >> deafened >> inGain >> outGain) ||
        startCommand != "start" || (muted != "0" && muted != "1") || (deafened != "0" && deafened != "1") ||
        !gainValue(inGain, cfg.inputGain) || !gainValue(outGain, cfg.outputGain)) return false;
    cfg.muted = muted == "1"; cfg.deafened = deafened == "1";
    if (controls >> peerControls) {
        if (controls >> extra) return false;
        std::istringstream entries(peerControls);
        std::string entry;
        while (std::getline(entries, entry, ',')) {
            const auto first = entry.find(':'), last = entry.rfind(':');
            float gain = 0;
            if (first == std::string::npos || last != first + 2 || entry.size() != last + 2 ||
                !gainValue(entry.substr(0, first), gain) || (entry[first + 1] != '0' && entry[first + 1] != '1') ||
                (entry[last + 1] != '0' && entry[last + 1] != '1')) return false;
            cfg.peerGains.push_back(gain);
            cfg.canPublish.push_back(entry[first + 1] == '1'); cfg.canReceive.push_back(entry[last + 1] == '1');
        }
        if (cfg.peerGains.size() != cfg.peers.size() || peerControls.back() == ',') return false;
    }
    return true;
}
bool parseConfig(Input& input, Config& cfg, bool loopback) {
    return parseFields([&](std::string& line) { return input.line(line); }, cfg, loopback);
}

void put(std::uint8_t* p, std::uint64_t value, unsigned bytes) noexcept {
    for (unsigned i = 0; i < bytes; ++i) p[bytes - i - 1] = static_cast<std::uint8_t>(value >> (i * 8));
}
std::uint64_t get(const std::uint8_t* p, unsigned bytes) noexcept {
    std::uint64_t result = 0;
    for (unsigned i = 0; i < bytes; ++i) result = (result << 8) | p[i];
    return result;
}

class Hmac {
public:
    explicit Hmac(const std::array<std::uint8_t, 32>& key) : key_(key) {
        if (BCryptOpenAlgorithmProvider(&algorithm_, BCRYPT_SHA256_ALGORITHM, nullptr, BCRYPT_ALG_HANDLE_HMAC_FLAG) < 0)
            throw std::runtime_error("crypto-init");
        DWORD size = 0;
        DWORD length = 0;
        if (BCryptGetProperty(algorithm_, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&size), sizeof(size), &length, 0) < 0) {
            BCryptCloseAlgorithmProvider(algorithm_, 0);
            algorithm_ = nullptr;
            throw std::runtime_error("crypto-init");
        }
        try { object_.resize(size); }
        catch (...) { BCryptCloseAlgorithmProvider(algorithm_, 0); algorithm_ = nullptr; throw; }
    }
    ~Hmac() {
        SecureZeroMemory(key_.data(), key_.size());
        SecureZeroMemory(object_.data(), object_.size());
        if (algorithm_) BCryptCloseAlgorithmProvider(algorithm_, 0);
    }
    bool sign(const std::uint8_t* bytes, std::size_t length, std::uint8_t* digest) noexcept {
        BCRYPT_HASH_HANDLE hash = nullptr;
        if (BCryptCreateHash(algorithm_, &hash, object_.data(), static_cast<ULONG>(object_.size()),
                key_.data(), static_cast<ULONG>(key_.size()), 0) < 0) return false;
        const bool ok = BCryptHashData(hash, const_cast<PUCHAR>(bytes), static_cast<ULONG>(length), 0) >= 0 &&
            BCryptFinishHash(hash, digest, tagBytes, 0) >= 0;
        BCryptDestroyHash(hash);
        return ok;
    }
private:
    BCRYPT_ALG_HANDLE algorithm_ = nullptr;
    std::array<std::uint8_t, 32> key_;
    std::vector<std::uint8_t> object_;
};

struct ReplaySession {
    std::array<std::uint8_t, 16> nonce{};
    std::uint64_t highest = 0;
    std::uint64_t seen = 0;
};
enum class Check { accepted, invalid, authentication, replay };
class Envelope {
public:
    explicit Envelope(const Config& cfg) : cfg_(cfg), hmac_(cfg.key), sessions_(cfg.peers.size()) {
        if (BCryptGenRandom(nullptr, nonce_.data(), static_cast<ULONG>(nonce_.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0)
            throw std::runtime_error("crypto-init");
    }
    bool encode(const std::uint8_t* bytes, std::size_t length, PeerAddress destination,
                std::vector<std::uint8_t>& wire, std::uint64_t now) {
        if (!bytes || !length || length > Engine::maxPacketBytes || sequence_ == UINT64_MAX || !known(destination)) return false;
        wire.resize(headerBytes + length + tagBytes);
        auto* p = wire.data();
        p[0] = 'L'; p[1] = 'K'; p[2] = 'A'; p[3] = '1';
        put(p + 4, length, 2);
        put(p + 6, cfg_.local.ipv4, 4); put(p + 10, cfg_.local.port, 2);
        put(p + 12, destination.ipv4, 4); put(p + 16, destination.port, 2);
        std::copy(nonce_.begin(), nonce_.end(), p + 18);
        put(p + 34, ++sequence_, 8); put(p + 42, now, 8);
        p[50] = 0; p[51] = 0;
        std::copy(bytes, bytes + length, p + headerBytes);
        return hmac_.sign(p, headerBytes + length, p + headerBytes + length);
    }
    Check decode(const std::uint8_t* wire, std::size_t length, PeerAddress from,
                 std::uint64_t now, const std::uint8_t*& payload, std::size_t& payloadLength) {
        const auto index = peerIndex(from);
        if (index == cfg_.peers.size() || length <= headerBytes + tagBytes || length > maxWireBytes ||
            wire[0] != 'L' || wire[1] != 'K' || wire[2] != 'A' || wire[3] != '1' || wire[50] || wire[51]) return Check::invalid;
        payloadLength = static_cast<std::size_t>(get(wire + 4, 2));
        if (payloadLength + headerBytes + tagBytes != length || get(wire + 6, 4) != from.ipv4 || get(wire + 10, 2) != from.port ||
            get(wire + 12, 4) != cfg_.local.ipv4 || get(wire + 16, 2) != cfg_.local.port) return Check::invalid;
        std::array<std::uint8_t, tagBytes> digest{};
        if (!hmac_.sign(wire, length - tagBytes, digest.data())) return Check::authentication;
        unsigned difference = 0;
        for (std::size_t i = 0; i < tagBytes; ++i) difference |= digest[i] ^ wire[length - tagBytes + i];
        if (difference) return Check::authentication;
        const auto timestamp = get(wire + 42, 8);
        const auto age = now >= timestamp ? now - timestamp : timestamp - now;
        const auto sequence = get(wire + 34, 8);
        if (age > freshnessMs || !sequence) return Check::replay;
        auto& peerSessions = sessions_[index];
        auto session = std::find_if(peerSessions.begin(), peerSessions.end(), [&](const auto& s) {
            return std::equal(s.nonce.begin(), s.nonce.end(), wire + 18);
        });
        if (session == peerSessions.end()) {
            // Never evict a nonce during this run: eviction would reopen old
            // sequences to replay. Reconfigure after eight peer restarts.
            if (peerSessions.size() >= 8) return Check::replay;
            ReplaySession fresh;
            std::copy(wire + 18, wire + 34, fresh.nonce.begin());
            peerSessions.push_back(fresh);
            session = peerSessions.end() - 1;
        }
        if (sequence > session->highest) {
            const auto advance = sequence - session->highest;
            session->seen = advance >= 64 ? 1 : (session->seen << advance) | 1;
            session->highest = sequence;
        } else {
            const auto distance = session->highest - sequence;
            if (distance >= 64 || (session->seen & (1ULL << distance))) return Check::replay;
            session->seen |= 1ULL << distance;
        }
        payload = wire + headerBytes;
        return Check::accepted;
    }
    bool known(PeerAddress peer) const { return peerIndex(peer) != cfg_.peers.size(); }
private:
    std::size_t peerIndex(PeerAddress peer) const {
        return static_cast<std::size_t>(std::find(cfg_.peers.begin(), cfg_.peers.end(), peer) - cfg_.peers.begin());
    }
    const Config& cfg_;
    Hmac hmac_;
    std::array<std::uint8_t, 16> nonce_{};
    std::uint64_t sequence_ = 0;
    std::vector<std::vector<ReplaySession>> sessions_;
};

bool transientReceiveError(int code) noexcept {
    // Windows UDP can surface ICMP from a peer whose helper has not started.
    // This is a per-datagram loss, not a reason to stop all other peers.
    return code == WSAECONNRESET || code == WSAECONNREFUSED || code == WSAENETRESET ||
        code == WSAEMSGSIZE || code == WSAEINTR;
}

PaDeviceIndex defaultDevice(bool capture) {
    const auto wasapi = Pa_HostApiTypeIdToHostApiIndex(paWASAPI);
    const auto* host = wasapi >= 0 ? Pa_GetHostApiInfo(wasapi) : nullptr;
    if (host) {
        const auto device = capture ? host->defaultInputDevice : host->defaultOutputDevice;
        if (device != paNoDevice) return device;
    }
    return capture ? Pa_GetDefaultInputDevice() : Pa_GetDefaultOutputDevice();
}

template<class Supported>
bool selectChannelFormat(int maxInput, int maxOutput, int& input, int& output, Supported supported) {
    for (int in = 1; in <= 2; ++in) {
        for (const int out : {1, 2, maxOutput > 2 ? maxOutput : 0}) {
            if (out < 1 || in > maxInput || out > maxOutput) continue;
            if (supported(in, out)) { input = in; output = out; return true; }
        }
    }
    return false;
}

void renderMono(const float* mono, float* output, unsigned long frames, int channels) noexcept {
    // WASAPI's native mix format can be surround. Voice belongs in the front
    // left/right pair; all other output channels must be explicitly silent.
    std::fill(output, output + frames * channels, 0.f);
    for (unsigned long i = 0; i < frames; ++i) {
        output[i * channels] = mono[i];
        if (channels > 1) output[i * channels + 1] = mono[i];
    }
}

bool selectDeviceFormat(PaStreamParameters& in, PaStreamParameters& out,
                        const PaDeviceInfo& input, const PaDeviceInfo& output) {
    in.sampleFormat = out.sampleFormat = paFloat32;
    in.suggestedLatency = input.defaultLowInputLatency;
    out.suggestedLatency = output.defaultLowOutputLatency;
    return selectChannelFormat(input.maxInputChannels, output.maxOutputChannels,
        in.channelCount, out.channelCount, [&](int inputChannels, int outputChannels) {
            in.channelCount = inputChannels; out.channelCount = outputChannels;
            return Pa_IsFormatSupported(&in, &out, 48000) == paFormatIsSupported;
        });
}

struct Host {
    explicit Host(const Config& config) : cfg(config), envelope(config) {
        for (std::size_t i = 0; i < cfg.peers.size(); ++i) {
            const bool controls = !cfg.peerGains.empty();
            if (!engine.addPeer(cfg.peers[i], controls ? cfg.canPublish[i] : true, controls ? cfg.canReceive[i] : true))
                throw std::runtime_error("engine-peer");
            if (controls && !engine.setPeerGain(cfg.peers[i], cfg.peerGains[i])) throw std::runtime_error("engine-peer");
        }
        muted.store(cfg.muted); deafened.store(cfg.deafened);
        inputGain.store(cfg.inputGain); engine.setOutputGain(cfg.outputGain);
    }
    const Config& cfg;
    Engine engine;
    Envelope envelope;
    SOCKET socket = INVALID_SOCKET;
    std::atomic<bool> stopping{false};
    std::atomic<bool> muted{false};
    std::atomic<bool> deafened{false};
    std::atomic<float> inputGain{1.f};
    std::atomic<bool> networkFailed{false};
    std::atomic<std::uint64_t> authRejected{0}, replayRejected{0}, udpSent{0}, udpReceived{0}, transportRejected{0};
    std::atomic<std::uint64_t> sendFailures{0}, captureUnderflows{0}, captureOverflows{0}, playbackUnderflows{0}, playbackOverflows{0};
    std::atomic<std::uint64_t> callbackErrors{0};
    std::atomic<float> captureRms{0}, playbackRms{0};
    std::vector<std::uint8_t> wire;
    std::array<float, 480> silence{};
    std::array<float, 480> monoInput{}, monoOutput{};
    int inputChannels = 1, outputChannels = 1;
    int inputDevice = -1, outputDevice = -1;
    const std::uint64_t initialNtp = ntpNow();
    const std::chrono::steady_clock::time_point initialSteady = std::chrono::steady_clock::now();

    std::uint64_t audioNtp() const noexcept {
        const auto ns = static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now() - initialSteady).count());
        return initialNtp + ((ns / 1000000000ULL) << 32) +
            (ns % 1000000000ULL) * 4294967296ULL / 1000000000ULL;
    }

    static int audio(const void* input, void* output, unsigned long frames,
                     const PaStreamCallbackTimeInfo*, PaStreamCallbackFlags flags, void* context) noexcept {
        auto& host = *static_cast<Host*>(context);
        auto* out = static_cast<float*>(output);
        if (host.stopping.load(std::memory_order_relaxed)) {
            if (out) std::fill(out, out + frames * host.outputChannels, 0.f);
            return paComplete;
        }
        if (!out || frames != 480) {
            ++host.callbackErrors;
            if (out) std::fill(out, out + frames * host.outputChannels, 0.f);
            return paContinue;
        }
        const auto* in = static_cast<const float*>(input);
        if (flags & paInputUnderflow) ++host.captureUnderflows;
        if (flags & paInputOverflow) ++host.captureOverflows;
        if (flags & paOutputUnderflow) ++host.playbackUnderflows;
        if (flags & paOutputOverflow) ++host.playbackOverflows;
        const bool deafened = host.deafened.load(std::memory_order_relaxed);
        const bool muted = host.muted.load(std::memory_order_relaxed) || deafened;
        if (in && !muted) {
            const auto gain = host.inputGain.load(std::memory_order_relaxed);
            for (unsigned long i = 0; i < frames; ++i) {
                const auto sample = host.inputChannels == 2 ? (in[i * 2] + in[i * 2 + 1]) * .5f : in[i];
                host.monoInput[i] = std::isfinite(sample) ? std::clamp(sample * gain, -1.f, 1.f) : 0.f;
            }
            in = host.monoInput.data();
        }
        const auto* samples = (!in || muted) ? host.silence.data() : in;
        auto* mono = host.outputChannels > 1 ? host.monoOutput.data() : out;
        const bool ok = host.engine.process(samples, mono, static_cast<int>(frames), host.audioNtp());
        if (!ok) std::fill(mono, mono + frames, 0.f);
        if (deafened) std::fill(mono, mono + frames, 0.f);
        if (host.outputChannels > 1) renderMono(mono, out, frames, host.outputChannels);
        double capture = 0, playback = 0;
        for (unsigned long i = 0; i < frames; ++i) {
            capture += static_cast<double>(samples[i]) * samples[i];
            playback += static_cast<double>(mono[i]) * mono[i];
        }
        host.captureRms.store(static_cast<float>(std::sqrt(capture / frames)), std::memory_order_relaxed);
        host.playbackRms.store(static_cast<float>(std::sqrt(playback / frames)), std::memory_order_relaxed);
        return paContinue;
    }
    static bool transmit(void* context, const std::uint8_t* bytes, std::size_t length, PeerAddress destination) {
        auto& host = *static_cast<Host*>(context);
        if (host.stopping.load() || !host.envelope.encode(bytes, length, destination, host.wire, unixMillis())) {
            ++host.sendFailures; return false;
        }
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(destination.ipv4);
        address.sin_port = htons(destination.port);
        const int sent = sendto(host.socket, reinterpret_cast<const char*>(host.wire.data()), static_cast<int>(host.wire.size()),
                                0, reinterpret_cast<const sockaddr*>(&address), sizeof(address));
        if (sent != static_cast<int>(host.wire.size())) { ++host.sendFailures; return false; }
        ++host.udpSent;
        return true;
    }
    void network() noexcept {
        try {
            std::array<std::uint8_t, maxWireBytes + 1> bytes{};
            while (!stopping.load()) {
                fd_set readSet;
                FD_ZERO(&readSet); FD_SET(socket, &readSet);
                timeval timeout{0, 5000};
                const int ready = select(0, &readSet, nullptr, nullptr, &timeout);
                if (ready == SOCKET_ERROR) { networkFailed.store(true); stopping.store(true); break; }
                if (ready > 0) {
                    // Bound receive work so unauthenticated traffic cannot starve
                    // outgoing media and the stop check.
                    for (unsigned i = 0; i < 64 && !stopping.load(); ++i) {
                        sockaddr_in from{};
                        int fromSize = sizeof(from);
                        const int received = recvfrom(socket, reinterpret_cast<char*>(bytes.data()), static_cast<int>(bytes.size()),
                            0, reinterpret_cast<sockaddr*>(&from), &fromSize);
                        if (received == SOCKET_ERROR) {
                            const int code = WSAGetLastError();
                            if (code == WSAEWOULDBLOCK) break;
                            if (transientReceiveError(code)) { ++transportRejected; continue; }
                            networkFailed.store(true); stopping.store(true); break;
                        }
                        ++udpReceived;
                        const PeerAddress peer{ntohl(from.sin_addr.s_addr), ntohs(from.sin_port)};
                        const std::uint8_t* payload = nullptr;
                        std::size_t payloadLength = 0;
                        const auto result = envelope.decode(bytes.data(), static_cast<std::size_t>(received), peer,
                                                            unixMillis(), payload, payloadLength);
                        if (result == Check::accepted) (void)engine.receive(payload, payloadLength, peer);
                        else if (result == Check::authentication) ++authRejected;
                        else if (result == Check::replay) ++replayRejected;
                        else ++transportRejected;
                    }
                }
                (void)engine.send(transmit, this);
            }
        } catch (...) { networkFailed.store(true); stopping.store(true); }
    }
    void stats() {
        const auto s = engine.stats();
        const float capture = captureRms.load(), playback = playbackRms.load();
        std::cout << "{\"event\":\"stats\",\"muted\":" << (muted.load() ? "true" : "false")
            << ",\"deafened\":" << (deafened.load() ? "true" : "false")
            << ",\"peers\":" << s.peers << ",\"processCalls\":" << s.processCalls
            << ",\"inputFrames\":" << s.inputFrames << ",\"outputActiveFrames\":" << s.outputActiveFrames
            << ",\"packetsSent\":" << s.packetsSent << ",\"bytesSent\":" << s.bytesSent
            << ",\"packetsReceived\":" << s.packetsReceived << ",\"bytesReceived\":" << s.bytesReceived
            << ",\"rejectedPackets\":" << s.rejectedPackets << ",\"processErrors\":" << s.processErrors
            << ",\"clippedSamples\":" << s.clippedSamples << ",\"authRejected\":" << authRejected.load()
            << ",\"replayRejected\":" << replayRejected.load() << ",\"transportRejected\":" << transportRejected.load()
            << ",\"udpSent\":" << udpSent.load() << ",\"udpReceived\":" << udpReceived.load()
            << ",\"sendFailures\":" << sendFailures.load()
            << ",\"callbackErrors\":" << callbackErrors.load()
            << ",\"captureUnderflows\":" << captureUnderflows.load() << ",\"captureOverflows\":" << captureOverflows.load()
            << ",\"playbackUnderflows\":" << playbackUnderflows.load() << ",\"playbackOverflows\":" << playbackOverflows.load()
            << ",\"fecEnabled\":" << (s.fecEnabled ? "true" : "false") << ",\"dtxEnabled\":" << (s.dtxEnabled ? "true" : "false")
            << ",\"captureRms\":" << (std::isfinite(capture) ? capture : 0)
            << ",\"playbackRms\":" << (std::isfinite(playback) ? playback : 0) << "}\n" << std::flush;
    }
};

// The helper has no persistent state. If a vendor audio driver fails to return
// from cleanup, the controller gets a bounded process lifetime rather than a
// blocked window close. Only this process can be terminated by this watchdog.
class ShutdownDeadline {
public:
    ShutdownDeadline() : done_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {
        if (!done_) throw std::runtime_error("shutdown-watchdog");
        thread_ = std::thread([handle = done_] {
            if (WaitForSingleObject(handle, 3000) == WAIT_TIMEOUT) TerminateProcess(GetCurrentProcess(), 6);
        });
    }
    ~ShutdownDeadline() { SetEvent(done_); thread_.join(); CloseHandle(done_); }
private:
    HANDLE done_;
    std::thread thread_;
};

int devices() {
    if (Pa_Initialize() != paNoError) { error("audio-init"); return 2; }
    const int count = Pa_GetDeviceCount();
    if (count < 0) { Pa_Terminate(); error("audio-enumeration"); return 2; }
    std::cout << "{\"event\":\"devices\",\"defaultInput\":" << defaultDevice(true)
        << ",\"defaultOutput\":" << defaultDevice(false) << ",\"devices\":[";
    for (int i = 0; i < count; ++i) {
        const auto* device = Pa_GetDeviceInfo(i);
        if (i) std::cout << ',';
        std::cout << "{\"index\":" << i << ",\"name\":" << jsonString(device->name)
            << ",\"maxInputChannels\":" << device->maxInputChannels << ",\"maxOutputChannels\":" << device->maxOutputChannels
            << ",\"defaultSampleRate\":" << device->defaultSampleRate << '}';
    }
    std::cout << "]}\n" << std::flush;
    ShutdownDeadline deadline;
    Pa_Terminate();
    return 0;
}

int checkDeviceFormat() {
    if (Pa_Initialize() != paNoError) { error("audio-init"); return 2; }
    PaStreamParameters in{}, out{};
    in.device = defaultDevice(true); out.device = defaultDevice(false);
    const auto* input = Pa_GetDeviceInfo(in.device);
    const auto* output = Pa_GetDeviceInfo(out.device);
    const char* failure = !input || !output || input->maxInputChannels < 1 || output->maxOutputChannels < 1
        ? "audio-device" : !selectDeviceFormat(in, out, *input, *output) ? "audio-format" : nullptr;
    if (failure) error(failure);
    else std::cout << "{\"event\":\"device-format\",\"inputDevice\":" << in.device
        << ",\"outputDevice\":" << out.device << ",\"inputChannels\":" << in.channelCount
        << ",\"outputChannels\":" << out.channelCount
        << ",\"sampleRate\":48000,\"audioOpened\":false,\"networkOpened\":false}\n" << std::flush;
    ShutdownDeadline deadline;
    Pa_Terminate();
    return failure ? 2 : 0;
}

int run(Config& cfg, Input& input) {
    Host host(cfg);
    WSADATA data{};
    if (WSAStartup(MAKEWORD(2, 2), &data)) { error("udp-init"); return 2; }
    host.socket = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    bool initialized = false;
    PaStream* stream = nullptr;
    std::thread network;
    int result = 0;
    const char* failure = nullptr;
    do {
        if (host.socket == INVALID_SOCKET) { failure = "udp-open"; break; }
        BOOL exclusive = TRUE;
        if (setsockopt(host.socket, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char*>(&exclusive), sizeof(exclusive)) == SOCKET_ERROR) {
            failure = "udp-exclusive"; break;
        }
        sockaddr_in local{};
        local.sin_family = AF_INET;
        local.sin_addr.s_addr = htonl(cfg.local.ipv4);
        local.sin_port = htons(cfg.local.port);
        if (bind(host.socket, reinterpret_cast<const sockaddr*>(&local), sizeof(local)) == SOCKET_ERROR) { failure = "udp-bind"; break; }
        u_long nonblocking = 1;
        if (ioctlsocket(host.socket, FIONBIO, &nonblocking) == SOCKET_ERROR) { failure = "udp-nonblocking"; break; }
        BOOL reportIcmp = FALSE;
        DWORD ioctlBytes = 0;
        if (WSAIoctl(host.socket, SIO_UDP_CONNRESET, &reportIcmp, sizeof(reportIcmp), nullptr, 0, &ioctlBytes, nullptr, nullptr) == SOCKET_ERROR) {
            failure = "udp-options"; break;
        }
        if (Pa_Initialize() != paNoError) { failure = "audio-init"; break; }
        initialized = true;
        PaStreamParameters in{}, out{};
        in.device = cfg.input == -1 ? defaultDevice(true) : cfg.input;
        out.device = cfg.output == -1 ? defaultDevice(false) : cfg.output;
        const auto* inDevice = Pa_GetDeviceInfo(in.device);
        const auto* outDevice = Pa_GetDeviceInfo(out.device);
        if (!inDevice || !outDevice || inDevice->maxInputChannels < 1 || outDevice->maxOutputChannels < 1) { failure = "audio-device"; break; }
        const bool format = selectDeviceFormat(in, out, *inDevice, *outDevice);
        if (!format) { failure = "audio-format"; break; }
        host.inputChannels = in.channelCount; host.outputChannels = out.channelCount;
        host.inputDevice = in.device; host.outputDevice = out.device;
        if (Pa_OpenStream(&stream, &in, &out, 48000, 480, paClipOff, Host::audio, &host) != paNoError) { failure = "audio-open"; break; }
        network = std::thread(&Host::network, &host);
        if (Pa_StartStream(stream) != paNoError) { failure = "audio-start"; break; }
        std::cout << "{\"event\":\"ready\",\"muted\":" << (host.muted.load() ? "true" : "false")
            << ",\"peerCount\":" << cfg.peers.size()
            << ",\"inputDevice\":" << in.device << ",\"outputDevice\":" << out.device
            << ",\"inputChannels\":" << in.channelCount << ",\"outputChannels\":" << out.channelCount
            << ",\"inputHostApi\":" << jsonString(Pa_GetHostApiInfo(inDevice->hostApi)->name)
            << ",\"outputHostApi\":" << jsonString(Pa_GetHostApiInfo(outDevice->hostApi)->name) << "}\n" << std::flush;
        auto nextStats = std::chrono::steady_clock::now();
        while (!host.stopping.load()) {
            std::string command;
            const int status = input.poll(command);
            if (status < 0 || command == "stop") host.stopping.store(true);
            else if (status > 0 && command == "mute") host.muted.store(true);
            else if (status > 0 && command == "unmute") host.muted.store(false);
            else if (status > 0 && command == "deafen") host.deafened.store(true);
            else if (status > 0 && command == "undeafen") host.deafened.store(false);
            else if (status > 0 && (command.rfind("input-gain ", 0) == 0 || command.rfind("output-gain ", 0) == 0)) {
                const bool capture = command.rfind("input-gain ", 0) == 0;
                float gain = 0.f;
                if (!gainValue(command.substr(capture ? 11 : 12), gain)) error("invalid-command");
                else if (capture) host.inputGain.store(gain);
                else host.engine.setOutputGain(gain);
            }
            else if (status > 0 && command.rfind("peer-gain ", 0) == 0) {
                std::istringstream values(command.substr(10));
                std::string endpoint, gainText, extra;
                PeerAddress peer; unsigned port = 0; float gain = 0.f;
                bool valid = bool(values >> endpoint >> gainText) && !(values >> extra);
                const auto colon = endpoint.find(':');
                valid = valid && colon != std::string::npos && ipv4(endpoint.substr(0, colon), peer.ipv4) &&
                    decimal(endpoint.substr(colon + 1), port, 65535) && gainValue(gainText, gain);
                peer.port = static_cast<std::uint16_t>(port);
                if (!valid || !host.engine.setPeerGain(peer, gain)) error("invalid-command");
            }
            else if (status > 0 && command.rfind("peer-permissions ", 0) == 0) {
                std::istringstream values(command.substr(17));
                std::string endpoint, publish, receive, extra;
                PeerAddress peer; unsigned port = 0;
                bool valid = bool(values >> endpoint >> publish >> receive) && !(values >> extra);
                const auto colon = endpoint.find(':');
                valid = valid && colon != std::string::npos && ipv4(endpoint.substr(0, colon), peer.ipv4) &&
                    decimal(endpoint.substr(colon + 1), port, 65535) && (publish == "0" || publish == "1") && (receive == "0" || receive == "1");
                peer.port = static_cast<std::uint16_t>(port);
                if (!valid || !host.engine.setPeerPermissions(peer, publish == "1", receive == "1")) error("invalid-command");
            }
            else if (status > 0) error("invalid-command");
            if (Pa_IsStreamActive(stream) <= 0 && !host.stopping.load()) { failure = "audio-inactive"; break; }
            const auto now = std::chrono::steady_clock::now();
            if (now >= nextStats) { host.stats(); nextStats = now + std::chrono::seconds(1); }
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        if (host.networkFailed.load()) failure = "udp-runtime";
    } while (false);
    ShutdownDeadline deadline;
    host.stopping.store(true);
    if (stream) { Pa_AbortStream(stream); Pa_CloseStream(stream); }
    if (network.joinable()) network.join();
    if (host.socket != INVALID_SOCKET) closesocket(host.socket);
    if (initialized) Pa_Terminate();
    WSACleanup();
    if (failure) { error(failure); result = 2; }
    event("stopped");
    return result;
}

int selfTest() {
    unsigned checks = 0;
    auto require = [&](bool ok) { if (!ok) throw std::runtime_error("self-test"); ++checks; };
    int selectedInput = 0, selectedOutput = 0;
    // WASAPI may reject mono/stereo requests for an eight-channel mix endpoint.
    // Exercise the exact selector used before opening the production stream.
    require(selectChannelFormat(2, 8, selectedInput, selectedOutput,
        [](int input, int output) { return input == 2 && output == 8; }));
    require(selectedInput == 2 && selectedOutput == 8);
    require(selectChannelFormat(2, 2, selectedInput, selectedOutput,
        [](int input, int output) { return input == 1 && output == 2; }));
    require(selectedInput == 1 && selectedOutput == 2);
    require(!selectChannelFormat(2, 8, selectedInput, selectedOutput,
        [](int, int) { return false; }));
    const std::array<float, 2> monoFixture{.25f, -.5f};
    for (const int channels : {2, 8}) {
        std::array<float, 18> outputFixture;
        outputFixture.fill(9.f);
        renderMono(monoFixture.data(), outputFixture.data() + 1, 2, channels);
        require(outputFixture.front() == 9.f && outputFixture[1 + 2 * channels] == 9.f);
        for (int i = 0; i < 2 * channels; ++i)
            require(outputFixture[1 + i] == (i % channels < 2 ? monoFixture[i / channels] : 0.f));
    }
    std::uint32_t address = 0;
    require(ipv4("10.203.217.1", address) && permitted(address, false));
    require(ipv4("10.203.217.254", address) && permitted(address, false));
    require(ipv4("10.203.217.0", address) && !permitted(address, false));
    require(ipv4("10.203.217.255", address) && !permitted(address, false));
    require(ipv4("0.0.0.0", address) && !permitted(address, false));
    require(ipv4("127.0.0.1", address) && !permitted(address, false) && permitted(address, true));
    require(ipv4("10.203.218.1", address) && !permitted(address, false));
    require(!ipv4("010.203.217.1", address) && !ipv4("10.203.217.1.extra", address));
    require(transientReceiveError(WSAECONNRESET) && transientReceiveError(WSAECONNREFUSED));
    require(transientReceiveError(WSAEMSGSIZE) && !transientReceiveError(WSAENOTSOCK));
    const std::vector<std::string> fields{"LAOKUAI_NATIVE_AUDIO_V1", "10.203.217.1", "39177",
        "10.203.217.2:39177", std::string(64, '1'), "duplex", "-1", "-1", "start"};
    auto configAccepted = [](const std::vector<std::string>& lines, bool loopback = false) {
        Config cfg;
        std::size_t index = 0;
        return parseFields([&](std::string& line) {
            if (index == lines.size()) return false;
            line = lines[index++]; return true;
        }, cfg, loopback);
    };
    require(configAccepted(fields));
    auto modified = fields;
    modified.pop_back(); require(!configAccepted(modified));
    modified = fields; modified[8] = "auto"; require(!configAccepted(modified));
    modified = fields; modified[1] = "0.0.0.0"; require(!configAccepted(modified));
    modified = fields; modified[3] = "192.168.1.2:39177"; require(!configAccepted(modified));
    modified = fields; modified[3] = "10.203.217.1:39177"; require(!configAccepted(modified));
    modified = fields; modified[3] += ",10.203.217.2:39177"; require(!configAccepted(modified));
    modified = fields; modified[3] = ""; require(configAccepted(modified));
    modified[8] = "start 1 1 0.5 2"; require(configAccepted(modified));
    modified[8] = "start 0 0 nan 1"; require(!configAccepted(modified));
    modified[8] = "start 0 0 1 2.1"; require(!configAccepted(modified));
    float gain = 0.f;
    require(gainValue("0", gain) && gain == 0.f);
    require(!gainValue("NaN", gain) && !gainValue("1 trailing", gain) && !gainValue("-1", gain));
    modified = fields; modified[4] = std::string(64, '0'); require(!configAccepted(modified));
    modified = fields; modified[4][0] = 'g'; require(!configAccepted(modified));
    modified = fields; modified[2] = "80"; require(!configAccepted(modified));
    modified = fields; modified[3] = "10.203.217.2:65536"; require(!configAccepted(modified));
    modified = fields; modified[6] = "-2"; require(!configAccepted(modified));
    modified = fields; modified[3].clear();
    for (int i = 2; i <= 12; ++i) modified[3] += (i == 2 ? "" : ",") + std::string("10.203.217.") + std::to_string(i) + ":39177";
    require(configAccepted(modified));
    modified[3] += ",10.203.217.13:39177"; require(!configAccepted(modified));
    modified = fields; modified[1] = "127.0.0.1"; modified[3] = "127.0.0.1:39178";
    require(!configAccepted(modified) && configAccepted(modified, true));
    Config sender, receiver;
    sender.local = {0x0acbd901U, 39177}; receiver.local = {0x0acbd902U, 39177};
    sender.peers.push_back(receiver.local); receiver.peers.push_back(sender.local);
    for (std::size_t i = 0; i < sender.key.size(); ++i) sender.key[i] = receiver.key[i] = static_cast<std::uint8_t>(i + 1);
    Envelope tx(sender), rx(receiver);
    const std::array<std::uint8_t, 5> data{1, 2, 3, 4, 5};
    std::vector<std::uint8_t> wire, first, second;
    const std::uint8_t* payload = nullptr;
    std::size_t length = 0;
    require(tx.encode(data.data(), data.size(), receiver.local, wire, 100000));
    first = wire;
    require(rx.decode(wire.data(), wire.size(), sender.local, 100000, payload, length) == Check::accepted &&
            length == data.size() && std::equal(data.begin(), data.end(), payload));
    require(rx.decode(wire.data(), wire.size(), sender.local, 100000, payload, length) == Check::replay);
    wire[headerBytes] ^= 1;
    require(rx.decode(wire.data(), wire.size(), sender.local, 100000, payload, length) == Check::authentication);
    require(rx.decode(first.data(), first.size(), {0x0acbd903U, 39177}, 100000, payload, length) == Check::invalid);
    require(rx.decode(first.data(), first.size() - 1, sender.local, 100000, payload, length) == Check::invalid);
    require(tx.encode(data.data(), data.size(), receiver.local, second, 100000));
    require(tx.encode(data.data(), data.size(), receiver.local, wire, 100000));
    require(rx.decode(wire.data(), wire.size(), sender.local, 100000, payload, length) == Check::accepted);
    require(rx.decode(second.data(), second.size(), sender.local, 100000, payload, length) == Check::accepted);
    require(rx.decode(second.data(), second.size(), sender.local, 100000, payload, length) == Check::replay);
    require(tx.encode(data.data(), data.size(), receiver.local, wire, 100000));
    require(rx.decode(wire.data(), wire.size(), sender.local, 130001, payload, length) == Check::replay);
    require(rx.decode(wire.data(), wire.size(), sender.local, 69999, payload, length) == Check::replay);
    require(rx.decode(wire.data(), wire.size(), sender.local, 100000, payload, length) == Check::accepted);
    require(!tx.encode(data.data(), Engine::maxPacketBytes + 1, receiver.local, wire, 100000));
    require(!tx.encode(data.data(), data.size(), {0x0acbd903U, 39177}, wire, 100000));
    Config wrong;
    wrong.local = receiver.local; wrong.peers = receiver.peers;
    wrong.key.fill(42);
    Envelope wrongRx(wrong);
    require(wrongRx.decode(first.data(), first.size(), sender.local, 100000, payload, length) == Check::authentication);
    require(tx.decode(first.data(), first.size(), receiver.local, 100000, payload, length) == Check::invalid);
    // A fresh authenticated session may restart its sequence; each nonce's
    // replay window stays allocated and old sessions can never be reopened.
    for (int i = 0; i < 7; ++i) {
        Envelope restarted(sender);
        require(restarted.encode(data.data(), data.size(), receiver.local, wire, 100000));
        require(rx.decode(wire.data(), wire.size(), sender.local, 100000, payload, length) == Check::accepted);
    }
    Envelope tooMany(sender);
    require(tooMany.encode(data.data(), data.size(), receiver.local, wire, 100000));
    require(rx.decode(wire.data(), wire.size(), sender.local, 100000, payload, length) == Check::replay);
    require(rx.decode(first.data(), first.size(), sender.local, 100000, payload, length) == Check::replay);
    for (unsigned i = 0; i < 65; ++i) require(tx.encode(data.data(), data.size(), receiver.local, wire, 100000));
    require(rx.decode(wire.data(), wire.size(), sender.local, 100000, payload, length) == Check::accepted);
    require(rx.decode(second.data(), second.size(), sender.local, 100000, payload, length) == Check::replay);
    std::cout << "{\"event\":\"self-test\",\"checks\":" << checks << ",\"networkOpened\":false,\"audioOpened\":false}\n" << std::flush;
    return 0;
}
} // namespace

int main(int argc, char** argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--self-test") return selfTest();
        if (argc == 2 && std::string(argv[1]) == "--devices") return devices();
        if (argc == 2 && std::string(argv[1]) == "--check-device-format") return checkDeviceFormat();
        const bool loopback = argc == 2 && std::string(argv[1]) == "--loopback-test";
        if (argc > 2 || (argc == 2 && !loopback && std::string(argv[1]) != "--stdio")) { error("invalid-arguments"); return 2; }
        Input input;
        Config config;
        if (!parseConfig(input, config, loopback)) { error("invalid-config"); return 2; }
        return run(config, input);
    } catch (...) {
        // Deliberately do not serialize exceptions, device driver messages,
        // credentials, addresses or stdin content.
        error("host-failure");
        return 2;
    }
}
