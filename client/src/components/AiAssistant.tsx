import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Bot, X, Send, Minimize2, Maximize2, Sparkles, ChevronDown, Mic, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatHistory {
  role: "user" | "assistant";
  content: string;
}

type VoiceState = "idle" | "recording" | "transcribing" | "speaking";

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 text-sm max-w-[75%]">
        <div className="flex gap-1 items-center h-4">
          <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

function SoundWave({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-0.5 h-5">
      {[0.4, 0.7, 1, 0.7, 0.5, 0.9, 0.6, 1, 0.4, 0.8].map((h, i) => (
        <span
          key={i}
          className={cn(
            "w-0.5 rounded-full transition-all duration-150",
            active ? "bg-red-400" : "bg-muted-foreground/30"
          )}
          style={{
            height: active ? `${Math.random() * 14 + 4}px` : `${h * 8}px`,
            animation: active ? `soundWave 0.6s ease-in-out ${i * 60}ms infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  const formatContent = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br/>");
  };

  return (
    <div
      className={cn("flex items-end gap-2 mb-3", isUser ? "flex-row-reverse" : "flex-row")}
      data-testid={`msg-bubble-${message.id}`}
    >
      {!isUser && (
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
      )}
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 text-sm max-w-[78%] leading-relaxed",
          isUser
            ? "bg-gradient-to-br from-violet-600 to-indigo-700 text-white rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        )}
        dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
      />
    </div>
  );
}

function VoiceButton({
  voiceState,
  onPress,
  onRelease,
  disabled,
}: {
  voiceState: VoiceState;
  onPress: () => void;
  onRelease: () => void;
  disabled: boolean;
}) {
  const isRecording = voiceState === "recording";
  const isTranscribing = voiceState === "transcribing";
  const isSpeaking = voiceState === "speaking";
  const busy = isTranscribing || disabled;

  return (
    <button
      onMouseDown={!busy && !isRecording ? onPress : undefined}
      onMouseUp={isRecording ? onRelease : undefined}
      onTouchStart={!busy && !isRecording ? (e) => { e.preventDefault(); onPress(); } : undefined}
      onTouchEnd={isRecording ? (e) => { e.preventDefault(); onRelease(); } : undefined}
      onClick={isRecording ? onRelease : (!busy ? onPress : undefined)}
      disabled={busy}
      data-testid="ai-mic-btn"
      title={
        isRecording
          ? "Soltar para enviar"
          : isTranscribing
          ? "Transcrevendo..."
          : isSpeaking
          ? "Ouvindo resposta..."
          : "Segurar para falar"
      }
      className={cn(
        "relative flex items-center justify-center w-10 h-10 shrink-0 rounded-xl border transition-all duration-200 select-none",
        isRecording
          ? "bg-red-500 border-red-500 text-white scale-110 shadow-lg shadow-red-500/30"
          : isTranscribing
          ? "bg-violet-100 border-violet-300 text-violet-500 dark:bg-violet-950 dark:border-violet-700 animate-pulse cursor-wait"
          : isSpeaking
          ? "bg-indigo-100 border-indigo-300 text-indigo-500 dark:bg-indigo-950 dark:border-indigo-700"
          : "border-border/60 text-muted-foreground hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950"
      )}
    >
      {isRecording ? (
        <Square className="w-4 h-4 fill-white" />
      ) : isTranscribing ? (
        <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
      ) : (
        <Mic className="w-4 h-4" />
      )}
      {isRecording && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-400 rounded-full animate-ping" />
      )}
    </button>
  );
}

export default function AiAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "👋 Olá! Sou a IA da **InvistaPRO** — agora com voz natural!\n\nPressione 🎤 e fale comigo, ou escreva sua pergunta:\n\n• \"Qual meu resultado hoje?\"\n• \"Iniciar o robô\"\n• \"Como estão meus trades?\"",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasNewMessage = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);

  const getBestVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis?.getVoices() || [];
    const priorities = [
      (v: SpeechSynthesisVoice) => v.lang === "pt-BR" && v.name.toLowerCase().includes("google"),
      (v: SpeechSynthesisVoice) => v.lang === "pt-BR" && v.name.toLowerCase().includes("microsoft"),
      (v: SpeechSynthesisVoice) => v.lang === "pt-BR" && !v.localService,
      (v: SpeechSynthesisVoice) => v.lang === "pt-BR",
      (v: SpeechSynthesisVoice) => v.lang.startsWith("pt"),
    ];
    for (const fn of priorities) {
      const found = voices.find(fn);
      if (found) return found;
    }
    return null;
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!voiceEnabled || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const clean = text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/[#•\[\]]/g, "")
        .replace(/\n+/g, ". ")
        .trim()
        .slice(0, 600);
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = "pt-BR";
      utterance.rate = 1.1;
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = getBestVoice();
      if (voice) utterance.voice = voice;
      utterance.onstart = () => setVoiceState("speaking");
      utterance.onend = () => setVoiceState("idle");
      utterance.onerror = () => setVoiceState("idle");
      synthRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [voiceEnabled, getBestVoice]
  );

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setVoiceState("idle");
  }, []);

  const chatMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const history: ChatHistory[] = messages
        .filter((m) => m.id !== "welcome")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await apiRequest("/api/ai-assistant/chat", {
        method: "POST",
        body: JSON.stringify({ message: userMessage, history }),
      });
      return res.json();
    },
    onSuccess: (data) => {
      const assistantMsg: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: data.message || "Desculpe, não consegui processar.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      hasNewMessage.current = true;
      if (voiceEnabled) speak(data.message || "");
      else setVoiceState("idle");
    },
    onError: () => {
      setVoiceState("idle");
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: "⚠️ Erro ao processar. Tente novamente.",
          timestamp: new Date(),
        },
      ]);
    },
  });

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || chatMutation.isPending) return;
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "user", content: trimmed, timestamp: new Date() },
      ]);
      setInput("");
      hasNewMessage.current = true;
      chatMutation.mutate(trimmed);
    },
    [chatMutation]
  );

  const startRecording = useCallback(async () => {
    if (voiceState !== "idle") return;
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg;codecs=opus";

      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size < 1000) { setVoiceState("idle"); return; }

        setVoiceState("transcribing");
        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");
          const res = await fetch("/api/ai-assistant/transcribe", {
            method: "POST",
            body: formData,
            credentials: "include",
          });
          const data = await res.json();
          const transcript = data.text?.trim();
          if (transcript && transcript.length > 1) {
            setMessages((prev) => [
              ...prev,
              { id: Date.now().toString(), role: "user", content: transcript, timestamp: new Date() },
            ]);
            hasNewMessage.current = true;
            chatMutation.mutate(transcript);
          } else {
            setVoiceState("idle");
          }
        } catch {
          setVoiceState("idle");
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setVoiceState("recording");
    } catch {
      setVoiceState("idle");
    }
  }, [voiceState, stopSpeaking, chatMutation]);

  const stopRecording = useCallback(() => {
    if (voiceState === "recording" && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, [voiceState]);

  useEffect(() => {
    if (scrollRef.current && (chatMutation.isPending || hasNewMessage.current)) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
      hasNewMessage.current = false;
    }
  }, [messages, chatMutation.isPending]);

  useEffect(() => {
    if (isOpen && inputRef.current) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  useEffect(() => {
    window.speechSynthesis?.getVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", () => {});
    return () => {
      mediaRecorderRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText(input);
    }
  };

  const panelWidth = isExpanded ? "w-[480px]" : "w-[360px]";
  const panelHeight = isExpanded ? "h-[580px]" : "h-[480px]";

  const voiceStatusText = {
    idle: "🎤 Segurar mic · Enter para enviar",
    recording: "🔴 Gravando... solte para enviar",
    transcribing: "⏳ Transcrevendo com Whisper...",
    speaking: "🔊 IA falando...",
  }[voiceState];

  return (
    <>
      <style>{`
        @keyframes soundWave {
          from { transform: scaleY(1); }
          to { transform: scaleY(2.5); }
        }
      `}</style>

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {isOpen && (
          <div
            className={cn(
              "flex flex-col rounded-2xl shadow-2xl border border-border/60 overflow-hidden transition-all duration-300",
              "bg-background/95 backdrop-blur-xl",
              panelWidth,
              panelHeight
            )}
            data-testid="ai-assistant-panel"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-700 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20">
                  {voiceState === "speaking" ? (
                    <div className="flex gap-0.5 items-end h-4">
                      {[1, 1.5, 2, 1.5, 1].map((h, i) => (
                        <span
                          key={i}
                          className="w-0.5 bg-white rounded-full"
                          style={{
                            height: `${h * 4}px`,
                            animation: `soundWave 0.5s ease-in-out ${i * 100}ms infinite alternate`,
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <Sparkles className="w-4 h-4 text-white" />
                  )}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm leading-none">IA InvistaPRO</p>
                  <p className="text-white/70 text-xs mt-0.5">
                    {voiceState === "recording"
                      ? "🔴 Gravando..."
                      : voiceState === "transcribing"
                      ? "✨ Transcrevendo..."
                      : voiceState === "speaking"
                      ? "🔊 Falando..."
                      : "Whisper · LLaMA 3.3 · Groq"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 hover:bg-white/20", voiceEnabled ? "text-white/80 hover:text-white" : "text-white/40")}
                  onClick={() => { if (voiceState === "speaking") stopSpeaking(); setVoiceEnabled((p) => !p); }}
                  title={voiceEnabled ? "Desativar voz" : "Ativar voz"}
                  data-testid="ai-voice-toggle-btn"
                >
                  {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
                  onClick={() => setIsExpanded((p) => !p)}
                  data-testid="ai-expand-btn"
                >
                  {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
                  onClick={() => setIsOpen(false)}
                  data-testid="ai-close-btn"
                >
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 px-4 py-3">
              <div>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {chatMutation.isPending && <TypingIndicator />}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>

            {/* Recording overlay */}
            {voiceState === "recording" && (
              <div className="mx-3 mb-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-2.5 flex items-center gap-3">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-ping shrink-0" />
                <SoundWave active={true} />
                <span className="text-xs text-red-600 dark:text-red-400 font-medium ml-auto">Gravando...</span>
              </div>
            )}

            {/* Input */}
            <div className="px-3 py-3 border-t border-border/50 shrink-0">
              <div className="flex items-end gap-2">
                <VoiceButton
                  voiceState={voiceState}
                  onPress={startRecording}
                  onRelease={stopRecording}
                  disabled={chatMutation.isPending}
                />
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    voiceState === "transcribing"
                      ? "✨ Transcrevendo..."
                      : voiceState === "recording"
                      ? "🔴 Gravando..."
                      : "Escreva ou use o microfone..."
                  }
                  className="resize-none min-h-[40px] max-h-[100px] text-sm rounded-xl border-border/60 focus-visible:ring-violet-500/50 bg-white text-black dark:bg-muted/40 dark:text-foreground placeholder:text-gray-400"
                  rows={1}
                  data-testid="ai-input"
                  disabled={voiceState === "recording" || voiceState === "transcribing"}
                />
                <Button
                  size="icon"
                  onClick={() => sendText(input)}
                  disabled={!input.trim() || chatMutation.isPending || voiceState === "recording" || voiceState === "transcribing"}
                  className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 hover:from-violet-500 hover:to-indigo-600 shadow-md"
                  data-testid="ai-send-btn"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/60 mt-1.5 text-center">{voiceStatusText}</p>
            </div>
          </div>
        )}

        {/* Toggle button */}
        <button
          onClick={() => setIsOpen((p) => !p)}
          data-testid="ai-toggle-btn"
          className={cn(
            "relative flex items-center justify-center w-14 h-14 rounded-full shadow-xl transition-all duration-300",
            "bg-gradient-to-br from-violet-600 to-indigo-700 hover:from-violet-500 hover:to-indigo-600",
            "hover:scale-110 active:scale-95",
            isOpen && "ring-4 ring-violet-400/40"
          )}
        >
          <div className={cn("transition-all duration-300", isOpen ? "opacity-100 scale-100" : "opacity-0 scale-0 absolute")}>
            <X className="w-6 h-6 text-white" />
          </div>
          <div className={cn("transition-all duration-300", !isOpen ? "opacity-100 scale-100" : "opacity-0 scale-0 absolute")}>
            <Bot className="w-6 h-6 text-white" />
          </div>
          {!isOpen && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-300 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-violet-400 items-center justify-center">
                <Sparkles className="w-2.5 h-2.5 text-white" />
              </span>
            </span>
          )}
        </button>
      </div>
    </>
  );
}
