import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { ingestAndClassify } from "@/lib/classify";

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { ok: false, error: "No audio file provided" },
        { status: 400 }
      );
    }

    // 1. Transcribe with Whisper
    const transcription = await getOpenAI().audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
    });

    const text = transcription.text;
    if (!text) {
      return NextResponse.json(
        { ok: false, error: "Transcription returned empty text" },
        { status: 422 }
      );
    }

    // 2. Ingest + classify the transcribed text
    const event = await ingestAndClassify(
      "voice_note",
      text.slice(0, 120),
      text
    );

    return NextResponse.json({
      ok: true,
      event_id: event.id,
      transcription: text,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
