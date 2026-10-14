#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>

namespace native_audio {

// IPv4 and UDP port are both host byte order. No DNS or sockets live in this core.
struct PeerAddress {
    std::uint32_t ipv4{};
    std::uint16_t port{};
    bool operator==(const PeerAddress& other) const noexcept {
        return ipv4 == other.ipv4 && port == other.port;
    }
};

struct EngineOptions {
    int sampleRate = 48000;
    int blockFrames = 480;
    int bitrate = 32000;
    double bufferSeconds = 0.120;
};

struct EngineStats {
    std::uint64_t processCalls{};
    std::uint64_t inputFrames{};
    std::uint64_t outputActiveFrames{};
    std::uint64_t packetsSent{};
    std::uint64_t bytesSent{};
    std::uint64_t packetsReceived{};
    std::uint64_t bytesReceived{};
    std::uint64_t rejectedPackets{};
    std::uint64_t processErrors{};
    std::uint64_t clippedSamples{};
    std::uint32_t peers{};
    bool fecEnabled = false;
    bool dtxEnabled = false;
};

// The callback is invoked synchronously by send(); bytes remain valid only until
// it returns. true means the transport accepted the complete datagram.
using PacketCallback = bool (*)(void* context, const std::uint8_t* bytes,
                               std::size_t size, PeerAddress destination);

// Configure peers before the first process/send/receive call. One audio thread
// owns process(); one separate network thread owns both receive() and send().
// stats() is safe on any thread. Stop/join both threads before destruction.
class Engine {
public:
    static constexpr std::size_t maxPeers = 11;
    static constexpr std::size_t maxPacketBytes = 4096;

    explicit Engine(const EngineOptions& options = {});
    ~Engine();
    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;
    Engine(Engine&&) = delete;
    Engine& operator=(Engine&&) = delete;

    bool addPeer(PeerAddress address, bool canPublish = true, bool canReceive = true);
    // Safe from the control thread; peers remain immutable while streaming.
    bool setPeerGain(PeerAddress address, float gain) noexcept;
    bool setOutputGain(float gain) noexcept;
    bool setPeerPermissions(PeerAddress address, bool canPublish, bool canReceive) noexcept;
    bool process(const float* input, float* output, int frames, std::uint64_t ntp) noexcept;
    bool receive(const std::uint8_t* bytes, std::size_t size, PeerAddress from) noexcept;
    bool send(PacketCallback callback, void* context) noexcept;
    EngineStats stats() const noexcept;
    const EngineOptions& options() const noexcept;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace native_audio
