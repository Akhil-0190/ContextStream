# Vendored MediaPipe runtime

`vision_bundle.js` and the files in `wasm/` (including the SIMD and non-SIMD variants) are vendored from `@mediapipe/tasks-vision` version 1.1.1. The upstream Apache License 2.0 is included as `LICENSE`.

The runtime is used locally by the extension's object-detection worker. It receives decoded frames from the extension; it does not send frame data to an external service.
