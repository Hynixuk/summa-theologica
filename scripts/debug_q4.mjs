import fs from "fs";
import { MPEGDecoder } from "mpg123-decoder";
import { pipeline } from "@huggingface/transformers";

function resampleLinear(float32, srcRate, dstRate) {
  if (srcRate === dstRate) return float32;
  const ratio = srcRate / dstRate;
  const newLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, float32.length - 1);
    const frac = srcPos - i0;
    out[i] = float32[i0] * (1 - frac) + float32[i1] * frac;
  }
  return out;
}

const AUDIO_PATH = "C:/Users/kulum/OneDrive/Documents/Video Editor/SummaTheologica/audio/vol01/04 - 04 - Question 4 The Perfection of God.mp3";
const buf = fs.readFileSync(AUDIO_PATH);
const decoder = new MPEGDecoder();
await decoder.ready;
const result = decoder.decode(buf);
decoder.free();
const ch0 = result.channelData[0];
const mono = ch0;
const full16k = resampleLinear(mono, result.sampleRate, 16000);

const transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-base.en", { dtype: "fp32" });
const output = await transcriber(full16k, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
fs.writeFileSync("C:/Users/kulum/AppData/Local/Temp/claude/C--Users-kulum-OneDrive-Documents-Video-Editor/e4d42ac4-a2ef-4644-8ed7-354df588cb00/scratchpad/debug_q4_transcript.json", JSON.stringify(output, null, 2));
console.log("done");
