# Receive correction display

The frozen Voice package exposes graph status, reason and latency, but no learned or applied automatic gain telemetry. All real remote participants therefore show unknown / not measured. RMS, targets, manual GainNode values and graph active are not gain telemetry. The ring neither enables nor adjusts DSP.

The fixture checks known positive, negative and zero values, formatting, nonfinite values, keyboard access and motion reduction. The main ring represents learnedAutoGainDb; details separately present appliedAutoGainDb. Manual volume and compressor or limiter reduction are excluded. A fixture pause can set applied to zero while keeping the learned ring unchanged. This is a display contract, not a claim that the frozen DSP retains long-term learning across pauses.

Future receiver-local batches must be limited to 5 Hz and bound to participantId + receiverId + physical microphone trackId + generation, with monotonic sequence numbers rejecting stale batches. Track aliases count once. Track replacement clears previous-generation values; no reading may transfer to another participant. Screen audio is excluded. No production protocol or new Voice telemetry API is added here.
