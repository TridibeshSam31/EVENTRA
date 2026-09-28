"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  MicOff,
  Square,
  Sparkles,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  FileText,
  Sliders,
  Calendar,
  MapPin,
  Users,
  DollarSign,
  Tag,
  Shield,
  Loader2,
  Send,
  Plus,
  X,
  Volume2,
  Check,
} from "lucide-react";
import { ProvenanceBadge } from "@/components/v2/ProvenanceBadge";
import {
  transcribeVoice,
  previewVoiceIntake,
  confirmVoiceIntake,
  VoiceIntakePreview,
  TranscribeResponse,
} from "@/lib/api/events";
import { setActiveEventId } from "@/stores/eventStore";

export interface VoiceIntakePanelProps {
  onCancel: () => void;
  onFillFormWithValues: (values: {
    name?: string;
    description?: string;
    start_datetime?: string;
    end_datetime?: string;
    location?: string;
    guest_count?: string;
    event_type?: string;
    total_budget?: string;
    currency?: string;
  }) => void;
}

type VoiceState =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "uploading"
  | "transcribing"
  | "transcript_review"
  | "extracting"
  | "review"
  | "confirming"
  | "error";

export function VoiceIntakePanel({
  onCancel,
  onFillFormWithValues,
}: VoiceIntakePanelProps) {
  const router = useRouter();

  // Primary workflow state
  const [state, setState] = useState<VoiceState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("" );
  const [isConfirming, setIsConfirming] = useState(false);

  // Audio recording state
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Transcription state
  const [transcript, setTranscript] = useState("");
  const [englishText, setEnglishText] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("en");
  const [activeTab, setActiveTab] = useState<"original" | "english">("original");

  // Extracted preview state
  const [preview, setPreview] = useState<VoiceIntakePreview | null>(null);

  // Editable fields in review mode
  const [editableFields, setEditableFields] = useState<Record<string, any>>({
    name: "",
    event_type: "CONFERENCE",
    location: "",
    guest_count: "",
    start_datetime: "",
    end_datetime: "",
    date_expression: "",
    total_budget: "",
    currency: "INR",
    requirements: [] as string[],
    description: "",
  });

  // Accepted AI suggestions
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<string[]>([]);
  // Organizer option to force-proceed even if some fields are missing
  const [forceProceedDefaults, setForceProceedDefaults] = useState(false);
  // Quick reply text for clarifying questions
  const [clarifyingAnswer, setClarifyingAnswer] = useState("");
  const [isSubmittingClarification, setIsSubmittingClarification] = useState(false);

  // Cleanup media stream and audio context on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);

  const cleanupAudio = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  // Start voice recording with live level visualizer & hard 3-min timeout
  const startRecording = async () => {
    setErrorMessage("");
    setState("requesting_permission");
    audioChunksRef.current = [];

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          "Audio recording is not supported in this browser. Please use a modern browser with microphone support or use the manual form."
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      audioStreamRef.current = stream;

      // Setup Web Audio Analyser for live volume meter
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateLevel = () => {
            if (analyserRef.current) {
              analyserRef.current.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const avg = sum / dataArray.length;
              setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
              animFrameRef.current = requestAnimationFrame(updateLevel);
            }
          };
          updateLevel();
        }
      } catch (err) {
        console.warn("AudioContext visualizer not supported:", err);
      }

      // Format selection: webm/opus preferred, fallback to mp4 for Safari
      let mimeType = "audio/webm;codecs=opus";
      if (typeof MediaRecorder !== "undefined") {
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          if (MediaRecorder.isTypeSupported("audio/mp4")) {
            mimeType = "audio/mp4";
          } else if (MediaRecorder.isTypeSupported("audio/webm")) {
            mimeType = "audio/webm";
          } else {
            mimeType = "";
          }
        }
      }

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        cleanupAudio();
        await handleAudioRecorded(mimeType);
      };

      recorder.start(250); // Slice data every 250ms
      setState("recording");
      setRecordingSeconds(0);

      // Start timer with hard 180-second limit (3 minutes)
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 179) {
            stopRecording();
            return 180;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      cleanupAudio();
      setState("error");
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setErrorMessage(
          "Microphone permission was denied. Please allow microphone access in your browser settings to speak, or switch to the manual form."
        );
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setErrorMessage(
          "No microphone found on your device. Please plug in a microphone or use the manual form."
        );
      } else {
        setErrorMessage(err.message || "Failed to access microphone.");
      }
    }
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  const cancelRecording = () => {
    cleanupAudio();
    audioChunksRef.current = [];
    if (transcript) {
      setState("transcript_review");
    } else {
      setState("idle");
    }
  };

  // Upload and transcribe speech audio
  const handleAudioRecorded = async (mimeType: string) => {
    if (audioChunksRef.current.length === 0) {
      setState("idle");
      return;
    }

    const actualMime = mimeType || "audio/webm";
    const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
    audioChunksRef.current = [];

    if (audioBlob.size < 200) {
      setState("error");
      setErrorMessage("No audible sound was detected. Please try speaking again.");
      return;
    }

    setState("uploading");

    try {
      const ext = actualMime.includes("mp4") ? "mp4" : "webm";
      const formData = new FormData();
      formData.append("file", audioBlob, `recording.${ext}`);

      setState("transcribing");
      const res: TranscribeResponse = await transcribeVoice(formData);

      // Append if organizer chose "Add more voice"
      const newOriginal = transcript ? `${transcript} ${res.text}` : res.text;
      const newEnglish = englishText
        ? `${englishText} ${res.english_text}`
        : res.english_text;

      setTranscript(newOriginal.trim());
      setEnglishText(newEnglish.trim());
      setDetectedLanguage(res.detected_language || "en");
      setState("transcript_review");
    } catch (err: any) {
      console.error("Voice transcription failed:", err);
      setState("error");
      setErrorMessage(
        err.message || "Speech transcription failed. Please try again or switch to manual typing."
      );
    }
  };

  // Extract structured intent from transcript for verification preview
  const handleExtractPreview = async (textToExtract?: string) => {
    const textOriginal = (textToExtract || transcript).trim();
    if (!textOriginal) return;

    setState("extracting");
    setErrorMessage("");

    try {
      const previewData: VoiceIntakePreview = await previewVoiceIntake({
        transcript: textOriginal,
        english_text: englishText.trim() || undefined,
        detected_language: detectedLanguage,
      });

      setPreview(previewData);

      // Populate editable fields from provenance map
      const fields = previewData.fields;
      setEditableFields({
        name: fields.name?.value || "",
        event_type: (fields.event_type?.value || "CONFERENCE").toUpperCase(),
        location: fields.location?.value || "",
        guest_count: fields.guest_count?.value ? String(fields.guest_count.value) : "",
        start_datetime: fields.start_datetime?.value || "",
        end_datetime: fields.end_datetime?.value || "",
        date_expression: fields.date_expression?.value || "",
        total_budget: fields.total_budget?.value ? String(fields.total_budget.value) : "",
        currency: fields.currency?.value || "INR",
        requirements: Array.isArray(fields.requirements?.value)
          ? fields.requirements.value
          : [],
        description: fields.description?.value || textOriginal.slice(0, 200),
      });

      // Default suggestions are NOT accepted until organizer explicitly checks them
      setAcceptedSuggestions([]);
      setState("review");
    } catch (err: any) {
      console.error("Preview extraction failed:", err);
      setState("error");
      setErrorMessage(
        err.message || "Failed to extract event specifications from transcript."
      );
    }
  };

  // Handle answering clarifying questions inline
  const handleClarifyingAnswerSubmit = async () => {
    if (!clarifyingAnswer.trim()) return;
    setIsSubmittingClarification(true);

    const updatedTranscript = `${transcript}. Clarification: ${clarifyingAnswer.trim()}`;
    const updatedEnglish = englishText
      ? `${englishText}. Clarification: ${clarifyingAnswer.trim()}`
      : updatedTranscript;

    setTranscript(updatedTranscript);
    setEnglishText(updatedEnglish);
    setClarifyingAnswer("");

    try {
      await handleExtractPreview(updatedTranscript);
    } finally {
      setIsSubmittingClarification(false);
    }
  };

  // Approve and continue: calls voice/confirm, generates plan, routes to /events/{id}
  const handleApproveAndContinue = async () => {
    setIsConfirming(true);
    setErrorMessage("");

    try {
      const payload = {
        fields: {
          name: editableFields.name.trim(),
          event_type: editableFields.event_type,
          location: editableFields.location.trim() || undefined,
          guest_count: editableFields.guest_count
            ? parseInt(editableFields.guest_count, 10)
            : undefined,
          total_budget: editableFields.total_budget
            ? parseFloat(editableFields.total_budget)
            : undefined,
          currency: editableFields.currency,
          date_expression: editableFields.date_expression || undefined,
          start_datetime: editableFields.start_datetime || undefined,
          end_datetime: editableFields.end_datetime || undefined,
          requirements: editableFields.requirements,
        },
        accepted_suggestions: acceptedSuggestions,
        detected_language: detectedLanguage,
        original_transcript: transcript,
        explicit_defaults_accepted: true,
        idempotency_key: `voice_confirm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      };

      const result = await confirmVoiceIntake(payload);
      const eventId =
        result.event_id || (result.event ? result.event.id : null);

      if (eventId) {
        setActiveEventId(eventId);
        router.push(`/events/${eventId}`);
      } else {
        router.push("/events");
      }
    } catch (err: any) {
      console.error("Voice confirmation failed:", err);
      setIsConfirming(false);
      setErrorMessage(
        err.message || "Failed to confirm event specification. Please check fields."
      );
    }
  };

  // Prefill manual wizard with approved values
  const handleFillFormInstead = () => {
    onFillFormWithValues({
      name: editableFields.name || undefined,
      description: editableFields.description || undefined,
      start_datetime: editableFields.start_datetime
        ? editableFields.start_datetime.split("T")[0]
        : undefined,
      end_datetime: editableFields.end_datetime
        ? editableFields.end_datetime.split("T")[0]
        : undefined,
      location: editableFields.location || undefined,
      guest_count: editableFields.guest_count || undefined,
      event_type: editableFields.event_type
        ? editableFields.event_type.toLowerCase()
        : undefined,
      total_budget: editableFields.total_budget || undefined,
      currency: editableFields.currency || "INR",
    });
  };

  // Helper formatting for recording timer
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}:${rem < 10 ? "0" : ""}${rem}`;
  };

  // Check if missing fields block approval (unless forceProceedDefaults is checked)
  const hasCriticalMissing = Boolean(
    preview &&
    preview.missing_fields.length > 0 &&
    !forceProceedDefaults
  );

  const isNameMissing = Boolean(!editableFields.name || editableFields.name.trim() === "");

  return (
    <div
      id="voice-intake-panel"
      className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-8 animate-in fade-in duration-200"
    >
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-5 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200 flex items-center gap-1.5">
              <Mic className="w-3 h-3 text-[#D6003C]" /> Voice Mode Active
            </span>
            <span className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
              <Shield className="w-3 h-3 text-emerald-600" /> Audio is not saved
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mt-1">
            Multilingual Voice Intake
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Speak in any language (English, Hindi, Hinglish, Tamil, etc.). AI transcribes, verifies facts, and requests your explicit approval.
          </p>
        </div>

        <button
          id="btn-type-instead"
          type="button"
          onClick={onCancel}
          className="self-start sm:self-center inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
        >
          <FileText className="w-3.5 h-3.5" /> Type instead
        </button>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">Attention Required</span>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage("")}
            className="text-rose-500 hover:text-rose-700 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* STATE 1: IDLE */}
      {state === "idle" && (
        <div className="py-8 px-4 text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-rose-50 border-2 border-rose-100 flex items-center justify-center mx-auto text-[#D6003C] shadow-sm">
            <Mic className="w-10 h-10 animate-pulse" />
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-base font-semibold text-slate-900">
              Tap to describe your event
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Tell us the event type, city, expected guests, dates, and budget. You can speak naturally in Hindi, English, or mixed Hinglish:
            </p>
            <div className="text-[11px] font-mono text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200/80 italic">
              &quot;Humein Delhi me ek wedding plan karni hai 15 November ko 500 logo ke liye, budget 25 lakh rupees hai.&quot;
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              id="btn-start-recording"
              type="button"
              onClick={startRecording}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-[#D6003C] hover:bg-[#b50033] text-white text-sm font-semibold shadow-sm transition transform active:scale-98"
            >
              <Mic className="w-4 h-4" /> Start Speaking
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              Use Manual Form Instead
            </button>
          </div>
        </div>
      )}

      {/* STATE 2: REQUESTING PERMISSION */}
      {state === "requesting_permission" && (
        <div className="py-12 text-center space-y-4">
          <Loader2 className="w-8 h-8 text-[#D6003C] animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-700">
            Requesting microphone access…
          </p>
          <p className="text-xs text-slate-400">
            Please approve the microphone prompt in your browser.
          </p>
        </div>
      )}

      {/* STATE 3: RECORDING */}
      {state === "recording" && (
        <div className="py-8 px-4 text-center space-y-6">
          <div className="relative w-24 h-24 rounded-full bg-rose-50 border-2 border-rose-200 flex items-center justify-center mx-auto text-[#D6003C]">
            <div
              className="absolute inset-0 rounded-full bg-rose-400 opacity-20 animate-ping"
              style={{ animationDuration: "1.5s" }}
            />
            <Mic className="w-10 h-10 relative z-10" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-100 text-[#D6003C] font-mono text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-[#D6003C] animate-pulse" />
              RECORDING • {formatTime(recordingSeconds)} / 3:00
            </div>
            <p className="text-xs text-slate-500">
              Speak clearly about your event details. Tap finish when done.
            </p>

            {/* Live Audio Level Waveform Indicator */}
            <div className="flex items-center justify-center gap-1.5 h-8 pt-2">
              {[0.4, 0.7, 1.0, 0.8, 0.5, 0.9, 0.6, 0.3].map((factor, idx) => (
                <span
                  key={idx}
                  className="w-1.5 rounded-full bg-[#D6003C] transition-all duration-75"
                  style={{
                    height: `${Math.max(6, Math.min(32, audioLevel * factor))}px`,
                    opacity: audioLevel > 10 ? 1 : 0.4,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <button
              id="btn-stop-recording"
              type="button"
              onClick={stopRecording}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-[#D6003C] hover:bg-[#b50033] text-white text-sm font-semibold shadow-sm transition transform active:scale-98"
            >
              <Square className="w-4 h-4 fill-white" /> Stop & Transcribe
            </button>
            <button
              type="button"
              onClick={cancelRecording}
              className="w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* STATE 4: UPLOADING & TRANSCRIBING */}
      {(state === "uploading" || state === "transcribing") && (
        <div className="py-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto text-slate-700">
            <Loader2 className="w-7 h-7 text-[#D6003C] animate-spin" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900">
              {state === "uploading"
                ? "Processing speech audio…"
                : "Multilingual transcription in progress…"}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Analyzing spoken phonetics across English, Hindi, and regional dialects. Audio is processed transiently and never saved.
            </p>
          </div>
        </div>
      )}

      {/* STATE 5: TRANSCRIPT REVIEW (Fix mishearings before extraction) */}
      {state === "transcript_review" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Step 1: Verify Transcript
              </span>
              <h3 className="text-base font-bold text-slate-900">
                Review what we heard
              </h3>
              <p className="text-xs text-slate-500">
                Check for any mishearings or typos below. You can edit the text or speak more before extracting details.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                Lang: {detectedLanguage}
              </span>
            </div>
          </div>

          {/* Transcript Tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("original")}
                  className={`text-xs font-semibold px-3 py-1 rounded-md transition ${
                    activeTab === "original"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Original Speech ({detectedLanguage})
                </button>
                {englishText && englishText !== transcript && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("english")}
                    className={`text-xs font-semibold px-3 py-1 rounded-md transition ${
                      activeTab === "english"
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    English Translation
                  </button>
                )}
              </div>
              <span className="text-[10px] text-slate-400">Editable</span>
            </div>

            {activeTab === "original" ? (
              <textarea
                id="transcript-box"
                rows={4}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                className="w-full p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 leading-relaxed font-sans"
                placeholder="Spoken transcript will appear here…"
              />
            ) : (
              <textarea
                id="english-transcript-box"
                rows={4}
                value={englishText}
                onChange={(e) => setEnglishText(e.target.value)}
                className="w-full p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 leading-relaxed font-sans"
                placeholder="English rendering…"
              />
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <button
              id="btn-add-more-voice"
              type="button"
              onClick={startRecording}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <Mic className="w-3.5 h-3.5 text-[#D6003C]" /> Add more voice
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onCancel}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Type instead
              </button>

              <button
                id="btn-analyze-details"
                type="button"
                onClick={() => handleExtractPreview()}
                disabled={!transcript.trim()}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs transition disabled:opacity-50"
              >
                <span>Analyze & Verify</span>
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATE 6: EXTRACTING PREVIEW */}
      {state === "extracting" && (
        <div className="py-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-violet-50 border border-violet-100 flex items-center justify-center mx-auto text-violet-600">
            <Sparkles className="w-7 h-7 animate-spin" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900">
              Extracting structured event specifications…
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Mapping facts to evidence quotes, checking provenance, and evaluating operational gaps without persisting any changes.
            </p>
          </div>
        </div>
      )}

      {/* STATE 7: REVIEW WHAT I UNDERSTOOD (VERIFICATION CARD) */}
      {state === "review" && preview && (
        <div className="space-y-8 animate-in fade-in duration-200">
          {/* Review Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-2">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Step 2: Verification Preview
              </span>
              <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight mt-1">
                Review what I understood
              </h3>
              <p className="text-xs text-slate-500">
                Check every field below. Stated details are verified against what you said. You can edit any value directly.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setState("transcript_review")}
              className="self-start sm:self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
            >
              <RotateCcw className="w-3 h-3" /> Edit / Speak again
            </button>
          </div>

          {/* Missing Fields Notice & Clarifying Questions (if any) */}
          {preview.missing_fields.length > 0 && (
            <div
              id="missing-fields-section"
              className="p-4 sm:p-5 rounded-xl bg-amber-50/80 border border-amber-200 space-y-3"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="text-xs font-bold text-amber-900">
                    Missing Information Required for Execution Plan
                  </span>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    The following attributes were not mentioned in your speech:{" "}
                    <strong>{preview.missing_fields.join(", ")}</strong>.
                  </p>
                </div>
              </div>

              {/* Clarifying Questions */}
              {preview.clarifying_questions.length > 0 && (
                <div className="bg-white/80 p-3 rounded-lg border border-amber-200/60 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Clarifying Questions:
                  </span>
                  <ul className="text-xs text-slate-700 space-y-1 list-disc list-inside">
                    {preview.clarifying_questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>

                  {/* Inline quick reply */}
                  <div className="pt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={clarifyingAnswer}
                      onChange={(e) => setClarifyingAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleClarifyingAnswerSubmit();
                      }}
                      placeholder="Type quick answer (e.g. Budget 10 lakh in Gurgaon)…"
                      className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <button
                      type="button"
                      onClick={handleClarifyingAnswerSubmit}
                      disabled={isSubmittingClarification || !clarifyingAnswer.trim()}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition disabled:opacity-50 shrink-0"
                    >
                      {isSubmittingClarification ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        "Answer"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={startRecording}
                      title="Speak your answer"
                      className="p-1.5 rounded-lg border border-slate-200 text-[#D6003C] hover:bg-rose-50 transition shrink-0"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Optional override toggle */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="chk-force-defaults"
                  checked={forceProceedDefaults}
                  onChange={(e) => setForceProceedDefaults(e.target.checked)}
                  className="rounded border-slate-300 text-[#D6003C] focus:ring-[#D6003C]"
                />
                <label
                  htmlFor="chk-force-defaults"
                  className="text-[11px] font-medium text-slate-700 cursor-pointer"
                >
                  Proceed anyway with standard platform defaults (generates plan immediately)
                </label>
              </div>
            </div>
          )}

          {/* Extracted Fields Grid */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Verified Event Attributes
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 1. Operation Name */}
              <div className="sm:col-span-2 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Operation Designation / Event Name *
                  </label>
                  <ProvenanceBadge
                    source={preview.fields.name?.source || "inferred"}
                    size="sm"
                  />
                </div>
                <input
                  id="field-name"
                  type="text"
                  required
                  value={editableFields.name}
                  onChange={(e) =>
                    setEditableFields((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="e.g. Delhi Grand Wedding 2026"
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                {preview.fields.name?.evidence_quote && (
                  <p className="text-[10px] text-slate-500 italic">
                    &quot;{preview.fields.name.evidence_quote}&quot;
                  </p>
                )}
                {preview.fields.name?.source === "inferred" && (
                  <p className="text-[10px] text-violet-600">
                    Suggested by AI because no explicit event title was stated. Editable above.
                  </p>
                )}
              </div>

              {/* 2. Event Type */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Event Classification
                  </label>
                  <ProvenanceBadge
                    source={preview.fields.event_type?.source || "stated"}
                    size="sm"
                  />
                </div>
                <select
                  id="field-event-type"
                  value={editableFields.event_type}
                  onChange={(e) =>
                    setEditableFields((prev) => ({
                      ...prev,
                      event_type: e.target.value,
                    }))
                  }
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="CONFERENCE">Conference / Summit</option>
                  <option value="WEDDING">Wedding / Social Gala</option>
                  <option value="COLLEGE_FEST">College Fest / Hackathon</option>
                  <option value="CORPORATE">Corporate Offsite</option>
                  <option value="EXHIBITION">Exhibition / Expo</option>
                  <option value="OTHER">Other / Custom</option>
                </select>
                {preview.fields.event_type?.evidence_quote && (
                  <p className="text-[10px] text-slate-500 italic">
                    &quot;{preview.fields.event_type.evidence_quote}&quot;
                  </p>
                )}
              </div>

              {/* 3. Venue / Location */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Target City / Location
                  </label>
                  <ProvenanceBadge
                    source={preview.fields.location?.source || "stated"}
                    size="sm"
                  />
                </div>
                <div className="relative">
                  <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    id="field-location"
                    type="text"
                    value={editableFields.location}
                    onChange={(e) =>
                      setEditableFields((prev) => ({
                        ...prev,
                        location: e.target.value,
                      }))
                    }
                    placeholder="e.g. Delhi, Mumbai, Bangalore"
                    className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                {preview.fields.location?.evidence_quote ? (
                  <p className="text-[10px] text-slate-500 italic">
                    &quot;{preview.fields.location.evidence_quote}&quot;
                  </p>
                ) : (
                  <p className="text-[10px] text-amber-600">
                    Not mentioned in transcript.
                  </p>
                )}
              </div>

              {/* 4. Projected Guest Count */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Projected Guests
                  </label>
                  <ProvenanceBadge
                    source={preview.fields.guest_count?.source || "stated"}
                    size="sm"
                  />
                </div>
                <div className="relative">
                  <Users className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    id="field-guest-count"
                    type="number"
                    value={editableFields.guest_count}
                    onChange={(e) =>
                      setEditableFields((prev) => ({
                        ...prev,
                        guest_count: e.target.value,
                      }))
                    }
                    placeholder="e.g. 500"
                    className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                  />
                </div>
                {preview.fields.guest_count?.evidence_quote ? (
                  <p className="text-[10px] text-slate-500 italic">
                    &quot;{preview.fields.guest_count.evidence_quote}&quot;
                  </p>
                ) : (
                  <p className="text-[10px] text-amber-600">
                    Not stated. Stays empty unless provided.
                  </p>
                )}
              </div>

              {/* 5. Date / Timing */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Date / Timing
                  </label>
                  <ProvenanceBadge
                    source={preview.fields.date_expression?.source || "stated"}
                    size="sm"
                  />
                </div>
                <div className="relative">
                  <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    id="field-date"
                    type="text"
                    value={editableFields.date_expression}
                    onChange={(e) =>
                      setEditableFields((prev) => ({
                        ...prev,
                        date_expression: e.target.value,
                      }))
                    }
                    placeholder="e.g. 15 November 2026 or Next Month"
                    className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                {preview.fields.date_expression?.evidence_quote && (
                  <p className="text-[10px] text-slate-500 italic">
                    &quot;{preview.fields.date_expression.evidence_quote}&quot;
                  </p>
                )}
              </div>

              {/* 6. Budget & Currency */}
              <div className="sm:col-span-2 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Total Allocated Budget & Currency
                  </label>
                  <ProvenanceBadge
                    source={preview.fields.total_budget?.source || "stated"}
                    size="sm"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2 relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      id="field-budget"
                      type="number"
                      value={editableFields.total_budget}
                      onChange={(e) =>
                        setEditableFields((prev) => ({
                          ...prev,
                          total_budget: e.target.value,
                        }))
                      }
                      placeholder="e.g. 2500000"
                      className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                    />
                  </div>
                  <select
                    id="field-currency"
                    value={editableFields.currency}
                    onChange={(e) =>
                      setEditableFields((prev) => ({
                        ...prev,
                        currency: e.target.value,
                      }))
                    }
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
                {preview.fields.total_budget?.evidence_quote ? (
                  <p className="text-[10px] text-slate-500 italic">
                    &quot;{preview.fields.total_budget.evidence_quote}&quot;
                  </p>
                ) : (
                  <p className="text-[10px] text-amber-600">
                    No budget stated in speech.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* AI Suggestions (Opt-in only, default UNCHECKED) */}
          {preview.suggestions && preview.suggestions.length > 0 && (
            <div className="p-4 sm:p-5 rounded-xl border border-violet-200 bg-violet-50/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-violet-950 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-600" /> Suggested Additions by AI (Not from you)
                </span>
                <span className="text-[10px] text-violet-700 font-medium">
                  Default: Not included until checked
                </span>
              </div>
              <p className="text-[11px] text-slate-600">
                Based on typical {editableFields.event_type.toLowerCase()} operations, the AI recommends considering these operational categories:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {preview.suggestions.map((sug) => {
                  const isChecked = acceptedSuggestions.includes(sug.id);
                  return (
                    <label
                      key={sug.id}
                      className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer transition ${
                        isChecked
                          ? "bg-white border-violet-400 shadow-xs"
                          : "bg-white/60 border-slate-200/80 hover:bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAcceptedSuggestions((prev) => [...prev, sug.id]);
                          } else {
                            setAcceptedSuggestions((prev) =>
                              prev.filter((id) => id !== sug.id)
                            );
                          }
                        }}
                        className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 mt-0.5"
                      />
                      <div className="space-y-0.5 flex-1">
                        <span className="font-semibold text-slate-900 block">
                          {sug.label}
                        </span>
                        <span className="text-[11px] text-slate-500 block leading-tight">
                          {sug.reason}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action Footer: Two explicit ways to finish */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              id="btn-fill-form-instead"
              type="button"
              onClick={handleFillFormInstead}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Fill the form with this instead
            </button>

            <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onCancel}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>

              <button
                id="btn-approve-and-continue"
                type="button"
                onClick={handleApproveAndContinue}
                disabled={isConfirming || isNameMissing || hasCriticalMissing}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#D6003C] hover:bg-[#b50033] text-white text-xs font-semibold shadow-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Materializing Plan…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve and continue</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATE 8: ERROR */}
      {state === "error" && (
        <div className="py-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto text-rose-600">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-sm font-semibold text-slate-900">
              Voice Processing Interrupted
            </h3>
            <p className="text-xs text-slate-500">
              {errorMessage || "An unexpected error occurred while processing voice input."}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={startRecording}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#D6003C] text-white text-xs font-semibold hover:bg-[#b50033] transition"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Try Again
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              Use Manual Form
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
