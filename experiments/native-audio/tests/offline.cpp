#include "audio_engine.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

using namespace native_audio;

namespace {
constexpr double pi = 3.14159265358979323846;
constexpr int frames = 480;
constexpr double duration = 10.0;

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

std::uint64_t ntp(double seconds) {
    // Each endpoint supplies its own simulated audio-clock timestamp. The
    // common NTP epoch is independent of wall time and no device is opened.
    const auto whole = static_cast<std::uint64_t>(seconds);
    const auto fraction = static_cast<std::uint64_t>((seconds - whole) * 4294967296.0);
    return ((3900000000ULL + whole) << 32) | fraction;
}

struct Datagram {
    std::array<std::uint8_t, Engine::maxPacketBytes> bytes{};
    std::size_t size{};
    PeerAddress from{};
    PeerAddress to{};
    double due{};
};

struct Node {
    PeerAddress address;
    std::unique_ptr<Engine> engine;
    double next{};
    double rate = 1.0;
    std::uint64_t samples{};
    double energy{};
    double tailEnergy{};
    double tailSin{};
    double tailCos{};
    std::uint64_t tailSamples{};
    std::uint64_t active{};
    float peak{};
    std::uint64_t interruptionSilentBlocks{};
    double recoveryMilliseconds = -1.0;
};

struct Simulation {
    std::vector<Node> nodes;
    std::vector<Datagram> queued;
    double now{};
    std::uint64_t sent{};
    std::uint64_t dropped{};
    std::uint64_t delivered{};
    bool impair = false;
    bool interrupt = false;
    bool mixing = false;
    bool controls = false;
    std::array<double, 5> controlEnergy{};
    double probeFrequency = 0;
    PeerAddress sending{};

    static bool packet(void* context, const std::uint8_t* bytes, std::size_t size,
                       PeerAddress to) {
        auto& sim = *static_cast<Simulation*>(context);
        ++sim.sent;
        if ((sim.impair && sim.sent % 10 == 0) ||
            (sim.interrupt && sim.now >= 3.0 && sim.now < 4.0)) {
            ++sim.dropped;
            return true; // The modeled UDP transport accepted and then lost it.
        }
        require(size > 0 && size <= Engine::maxPacketBytes, "invalid encoded datagram size");
        require(sim.queued.size() < 8192, "offline datagram queue exceeded its bound");
        Datagram datagram;
        std::copy(bytes, bytes + size, datagram.bytes.begin());
        datagram.size = size;
        datagram.from = sim.sending;
        datagram.to = to;
        datagram.due = sim.now + 0.005 + ((sim.impair && sim.sent % 7 == 0) ? 0.025 : 0.0);
        sim.queued.push_back(datagram);
        return true;
    }

    void run() {
        std::array<float, frames> input{};
        std::array<float, frames> output{};
        for (now = 0.0; now < duration; now += 0.001) {
            // Deliver by scheduled time, so later packets can overtake earlier
            // packets. AoO, rather than this harness, owns the jitter buffer.
            for (std::size_t index = 0; index < queued.size();) {
                if (queued[index].due > now) { ++index; continue; }
                auto datagram = queued[index];
                queued[index] = queued.back();
                queued.pop_back();
                auto destination = std::find_if(nodes.begin(), nodes.end(), [&](const Node& node) {
                    return node.address == datagram.to;
                });
                require(destination != nodes.end(), "AoO sent outside the configured peers");
                const bool accepted = destination->engine->receive(datagram.bytes.data(), datagram.size, datagram.from);
                constexpr char dataPattern[] = "/aoo/sink/1/data";
                const bool permissionRejection = controls && destination->address == nodes[0].address && now >= 5.0 && now < 7.0 &&
                    datagram.size >= sizeof(dataPattern) && std::equal(dataPattern, dataPattern + sizeof(dataPattern), datagram.bytes.begin());
                require(accepted || permissionRejection, "AoO rejected a valid modeled datagram");
                ++delivered;
            }
            for (std::size_t index = 0; index < nodes.size(); ++index) {
                auto& node = nodes[index];
                while (node.next <= now + 1e-9) {
                    if (controls && index == 0) {
                        require(node.engine->setPeerGain(nodes[1].address, now >= 3.0 && now < 5.0 ? 0.f : 1.f), "member gain update failed");
                        require(node.engine->setPeerPermissions(nodes[1].address, !(now >= 5.0 && now < 7.0), true), "publish permission update failed");
                        require(nodes[1].engine->setPeerPermissions(node.address, true, !(now >= 7.0 && now < 9.0)), "receive permission update failed");
                    }
                    for (int sample = 0; sample < frames; ++sample) {
                        const double phase = static_cast<double>(node.samples + sample) / 48000.0;
                        const double frequency = probeFrequency > 0 ? probeFrequency :
                            (mixing ? 440.0 : 300.0 + index * 137.0);
                        input[sample] = static_cast<float>((mixing ? 0.9 : 0.2) *
                                                          std::sin(2.0 * pi * frequency * phase));
                    }
                    require(node.engine->process(input.data(), output.data(), frames,
                                                  ntp(node.next)), "AoO audio processing failed");
                    double blockEnergy = 0;
                    for (int offset = 0; offset < frames; ++offset) {
                        const float sample = output[offset];
                        require(std::isfinite(sample), "decoded/mixed output is non-finite");
                        require(std::abs(sample) <= 1.0f, "decoded mix escaped output limiter");
                        node.peak = std::max(node.peak, std::abs(sample));
                        node.energy += static_cast<double>(sample) * sample;
                        blockEnergy += static_cast<double>(sample) * sample;
                        if (controls && index == 0) {
                            const int phase = now < 3 ? 0 : now < 5 ? 1 : now < 7 ? 2 : now < 9 ? 3 : 4;
                            const double start = phase == 0 ? 0 : phase == 1 ? 3 : phase == 2 ? 5 : phase == 3 ? 7 : 9;
                            if (now >= start + .5) controlEnergy[phase] += static_cast<double>(sample) * sample;
                        }
                        if (now >= 8.0) {
                            node.tailEnergy += static_cast<double>(sample) * sample;
                            // Magnitude of sine/cosine correlation is invariant
                            // to the codec/jitter delay. This distinguishes the
                            // decoded transmitted tone from arbitrary nonzero noise.
                            const double target = probeFrequency > 0 ? probeFrequency :
                                (mixing ? 440.0 : 300.0 + (index == 0 ? 137.0 : 0.0));
                            const double phase = 2.0 * pi * target *
                                static_cast<double>(node.samples + offset) / 48000.0;
                            node.tailSin += sample * std::sin(phase);
                            node.tailCos += sample * std::cos(phase);
                            ++node.tailSamples;
                        }
                        if (std::abs(sample) > 0.0001f) ++node.active;
                    }
                    if (interrupt && now >= 3.5 && now < 4.0 && blockEnergy / frames < 0.0001) {
                        ++node.interruptionSilentBlocks;
                    }
                    if (interrupt && now >= 4.0 && node.interruptionSilentBlocks > 0 &&
                        node.recoveryMilliseconds < 0 && blockEnergy / frames > 0.0001) {
                        node.recoveryMilliseconds = (now - 4.0) * 1000.0;
                    }
                    node.samples += frames;
                    node.next += 0.010 / node.rate;
                }
                sending = node.address;
                require(node.engine->send(packet, this), "AoO packet production failed");
            }
        }
    }
};

void scenario(const std::string& name, int bitrate, bool impaired, bool interrupted,
              double driftPpm, int count, bool mixing, double probeFrequency = 0) {
    Simulation simulation;
    simulation.impair = impaired;
    simulation.interrupt = interrupted;
    simulation.mixing = mixing;
    simulation.probeFrequency = probeFrequency;
    simulation.queued.reserve(8192);
    for (int index = 0; index < count; ++index) {
        EngineOptions options;
        options.bitrate = bitrate;
        Node node;
        node.address = {0x0A7B0001u + static_cast<std::uint32_t>(index), 19900};
        node.engine = std::make_unique<Engine>(options);
        node.rate = 1.0 + (index == 0 ? 0.0 : driftPpm / 1000000.0);
        simulation.nodes.push_back(std::move(node));
    }
    for (auto& node : simulation.nodes) {
        for (const auto& peer : simulation.nodes) {
            if (!(node.address == peer.address)) {
                require(node.engine->addPeer(peer.address), "failed to configure AoO peer");
            }
        }
    }
    if (mixing) for (auto& node : simulation.nodes) require(node.engine->setOutputGain(2.f), "valid output gain rejected");
    simulation.run();
    require(simulation.delivered > 100, "no actual AoO datagram traffic");
    std::uint64_t clipped = 0;
    std::uint64_t decoded = 0;
    std::uint64_t bytes = 0;
    double tailEnergy = 0;
    double minimumTonePurity = 1.0;
    double maximumRecoveryMilliseconds = 0;
    for (const auto& node : simulation.nodes) {
        const auto stats = node.engine->stats();
        require(node.active > 48000, "actual decoded output did not sustain signal");
        require(node.tailEnergy > 1.0, "audio failed to recover/sustain after impairment");
        const double purity = 2.0 * (node.tailSin * node.tailSin + node.tailCos * node.tailCos) /
                              (static_cast<double>(node.tailSamples) * node.tailEnergy);
        require(purity > (impaired ? 0.10 : 0.35), "decoded signal is not correlated with the transmitted tone");
        minimumTonePurity = std::min(minimumTonePurity, purity);
        if (interrupted) {
            require(node.interruptionSilentBlocks >= 10, "modeled outage did not interrupt decoded audio");
            require(node.recoveryMilliseconds >= 0 && node.recoveryMilliseconds < 800,
                    "actual decoded signal did not recover within 800 ms after outage");
            maximumRecoveryMilliseconds = std::max(maximumRecoveryMilliseconds, node.recoveryMilliseconds);
        }
        require(stats.packetsSent > 0 && stats.packetsReceived > 0, "codec transport counters are empty");
        require(stats.processErrors == 0, "core reported audio processing errors");
        if (mixing) {
            require(stats.clippedSamples == 0, "multi-source room mix hard-clipped decoded audio");
            require(node.peak <= .950001f, "multi-source limiter escaped its headroom bound");
        }
        require(!stats.fecEnabled && !stats.dtxEnabled, "FEC/DTX declaration differs from expected explicit settings");
        clipped += stats.clippedSamples;
        decoded += stats.outputActiveFrames;
        bytes += stats.bytesSent;
        tailEnergy += node.tailEnergy;
    }
    if (impaired || interrupted) require(simulation.dropped > 0, "impairment did not drop actual datagrams");
    std::cout << "{\"scenario\":\"" << name << "\",\"bitrate\":" << bitrate
              << ",\"peers\":" << count << ",\"driftPpm\":" << driftPpm
              << ",\"probeFrequencyHz\":" << probeFrequency
              << ",\"actualPacketsSent\":" << simulation.sent
              << ",\"actualPacketsDelivered\":" << simulation.delivered
              << ",\"actualPacketsDropped\":" << simulation.dropped
              << ",\"encodedBytes\":" << bytes << ",\"decodedActiveFrames\":" << decoded
              << ",\"clippedSamples\":" << clipped << ",\"tailEnergy\":" << tailEnergy
              << ",\"minimumTonePurity\":" << minimumTonePurity
              << ",\"maximumRecoveryMilliseconds\":" << maximumRecoveryMilliseconds
              << ",\"fec\":false,\"dtx\":false,\"passed\":true}\n";
    // Engines are destroyed here after all audio/network calls have ended.
}

void validation() {
    Engine engine;
    require(!engine.addPeer({0, 19900}), "zero IPv4 accepted");
    require(!engine.addPeer({0x0A000001u, 0}), "zero UDP port accepted");
    for (std::size_t index = 0; index < Engine::maxPeers; ++index) {
        require(engine.addPeer({0x0A000001u + static_cast<std::uint32_t>(index), 19900}),
                "valid bounded peer rejected");
    }
    require(!engine.addPeer({0x0A000100u, 19900}), "peer limit not enforced");
    require(engine.setPeerGain({0x0A000001u, 19900}, 0.f), "valid member mute rejected");
    require(engine.setPeerGain({0x0A000001u, 19900}, 2.f), "valid member gain rejected");
    require(!engine.setPeerGain({0x0A000001u, 19900}, std::numeric_limits<float>::quiet_NaN()), "NaN member gain accepted");
    require(!engine.setPeerGain({0x0A000001u, 19900}, 2.1f), "unbounded member gain accepted");
    require(!engine.setPeerGain({0x0A000100u, 19900}, 1.f), "unknown member gain accepted");
    require(!engine.setOutputGain(2.1f), "unbounded output gain accepted");
    require(engine.setPeerPermissions({0x0A000001u, 19900}, false, false), "bounded peer permissions rejected");
    require(!engine.setPeerPermissions({0x0A000100u, 19900}, false, false), "unknown peer permissions accepted");
    const std::array<std::uint8_t, 4> garbage{1, 2, 3, 4};
    require(!engine.receive(garbage.data(), garbage.size(), {0x0A000200u, 19900}),
            "unconfigured endpoint accepted");
    require(!engine.receive(nullptr, 10, {0x0A000001u, 19900}), "null packet accepted");
    std::array<float, frames> input{};
    std::array<float, frames> output{};
    input[0] = std::numeric_limits<float>::quiet_NaN();
    require(!engine.process(input.data(), output.data(), frames, ntp(0)), "NaN input accepted");
    require(!engine.addPeer({0x0A000002u, 19900}), "running configuration mutated");
    bool threw = false;
    try { EngineOptions options; options.bitrate = 17000; Engine invalid(options); }
    catch (const std::invalid_argument&) { threw = true; }
    require(threw, "unsupported bitrate accepted");
    std::cout << "{\"scenario\":\"input-bounds-and-shutdown\",\"passed\":true}\n";
}

void controlScenario() {
    Simulation sim;
    sim.controls = true;
    for (unsigned i = 0; i < 2; ++i) {
        Node node; node.address = {0x0A7B0001u + i, 19900}; node.engine = std::make_unique<Engine>();
        sim.nodes.push_back(std::move(node));
    }
    for (unsigned i = 0; i < 2; ++i) require(sim.nodes[i].engine->addPeer(sim.nodes[1 - i].address), "control peer failed");
    sim.run();
    require(sim.controlEnergy[0] > 1 && sim.controlEnergy[4] > 1, "actual codec failed to recover after controls");
    require(sim.controlEnergy[1] == 0, "member volume zero leaked decoded samples");
    require(sim.controlEnergy[2] == 0, "publish permission leaked decoded samples");
    require(sim.controlEnergy[3] < .01, "receive permission leaked sustained encoded audio");
    std::cout << "{\"scenario\":\"live-member-gain-and-permissions\",\"actualAooAndOpus\":true,\"passed\":true}\n";
}
} // namespace

int main() {
    try {
        validation();
        controlScenario();
        for (int bitrate : {24000, 32000, 48000, 64000}) {
            scenario("two-endpoint-baseline", bitrate, false, false, 0, 2, false);
        }
        scenario("loss-reorder-drift-100ppm", 32000, true, false, 100, 2, false);
        scenario("loss-reorder-drift-200ppm", 32000, true, false, 200, 2, false);
        scenario("one-second-interruption-recovery", 32000, false, true, 200, 2, false);
        scenario("three-endpoint-mix", 32000, false, false, 100, 3, true);
        scenario("twelve-endpoint-memory-capacity", 32000, false, false, 100, 12, true);
        scenario("six-khz-bandwidth-probe", 32000, false, false, 0, 2, false, 6000);
        std::cout << "{\"offlineOnly\":true,\"actualAooAndOpus\":true,\"devicesOpened\":0,\"socketsOpened\":0,\"passed\":true}\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "offline test failed: " << error.what() << '\n';
        return 1;
    }
}
