import { scanSemantics } from "./semantics.js";

const HEADER = /^@(Person|AI):([^\r\n:]{1,120})$/u;

function assertSpeaker(turn) {
  if (!turn || !["Person", "AI"].includes(turn.speakerType) ||
      typeof turn.speaker !== "string" ||
      !turn.speaker.trim() || turn.speaker !== turn.speaker.trim() ||
      turn.speaker.includes(":") || /[\r\n]/.test(turn.speaker) ||
      typeof turn.text !== "string") throw new Error("Invalid conversation turn");
}

export function serializeConversationBody(turns) {
  if (!Array.isArray(turns)) throw new TypeError("Expected turns array");
  for (const turn of turns) assertSpeaker(turn);
  return turns.map(turn => `@${turn.speakerType}:${turn.speaker}\n${turn.text.replace(/\r\n?/g, "\n")}`)
    .join("\n");
}

export function parseConversationBody(body) {
  if (typeof body !== "string") throw new TypeError("Expected conversation body");
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const turns = [];
  let offset = 0;
  let started = false;
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matchFence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const marker = !fence ? HEADER.exec(line) : null;
    if (marker) {
      if (started) {
        const previous = turns[turns.length - 1];
        previous.text = body.replace(/\r\n?/g, "\n").slice(previous.bodyStart, offset - 1);
        previous.tokens = scanSemantics(previous.text).tokens;
      }
      started = true;
      turns.push({ index: turns.length, speakerType: marker[1], speaker: marker[2],
        headerStart: offset, bodyStart: offset + line.length + 1, text: "" });
    } else if (!started && line.trim()) {
      throw new Error(`Unexpected content before conversation turn at line ${i + 1}`);
    }
    if (matchFence) {
      if (!fence) fence = { char: matchFence[1][0], length: matchFence[1].length };
      else if (matchFence[1][0] === fence.char && matchFence[1].length >= fence.length &&
          matchFence[2].trim() === "") fence = null;
    }
    offset += line.length + 1;
  }
  if (started) {
    const last = turns[turns.length - 1];
    last.text = body.replace(/\r\n?/g, "\n").slice(last.bodyStart);
    last.tokens = scanSemantics(last.text).tokens;
  }
  return turns;
}
