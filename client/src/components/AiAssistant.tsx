import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Bot, X, Send, Minimize2, Maximize2, Sparkles, ChevronDown, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
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

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  const formatContent = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>');
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

export default function AiAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "👋 Olá! Sou a IA da **InvistaPRO** — agora com LLaMA 3.3 70B.\n\nTenho acesso completo à sua conta. Pode me perguntar qualquer coisa ou usar o microfone 🎤 para falar comigo!\n\n• \"Qual meu resultado hoje?\"\n• \"Iniciar o robô\"\n• \"Como estão meus trades?\"",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [hasVoiceSupport, setHasVoiceSupport] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const hasNewMessage = useRef(false);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition && window.speechSynthesis) {
      setHasVoiceSupport(true);
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/[#\-•]/g, '')
      .replace(/\n+/g, '. ')
      .replace(/:{1}\s*/g, ': ')
      .trim()
      .slice(0, 500);
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(v => v.lang.startsWith('pt') && v.name.toLowerCase().includes('google'))
      || voices.find(v => v.lang.startsWith('pt'));
    if (ptVoice) utterance.voice = ptVoice;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    stopSpeaking();
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setInput(transcript);
        setTimeout(() => {
          sendMessage(transcript);
        }, 100);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  }, [stopSpeaking]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const chatMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const history: ChatHistory[] = messages
        .filter(m => m.id !== "welcome")
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

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
        content: data.message || "Desculpe, não consegui processar sua mensagem.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      hasNewMessage.current = true;
      if (voiceEnabled) {
        speak(data.message || "");
      }
    },
    onError: () => {
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: "⚠️ Ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    },
  });

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || chatMutation.isPending) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    hasNewMessage.current = true;
    chatMutation.mutate(trimmed);
  }, [chatMutation]);

  useEffect(() => {
    if (scrollRef.current && (chatMutation.isPending || hasNewMessage.current)) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
      hasNewMessage.current = false;
    }
  }, [messages, chatMutation.isPending]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const handleSend = () => {
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoice = () => {
    if (isSpeaking) stopSpeaking();
    setVoiceEnabled(p => !p);
  };

  const panelWidth = isExpanded ? "w-[480px]" : "w-[360px]";
  const panelHeight = isExpanded ? "h-[580px]" : "h-[480px]";

  return (
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
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-700 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm leading-none">IA InvistaPRO</p>
                <p className="text-white/70 text-xs mt-0.5">LLaMA 3.3 · Groq</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasVoiceSupport && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 hover:bg-white/20", isSpeaking ? "text-yellow-300" : "text-white/80 hover:text-white")}
                  onClick={toggleVoice}
                  title={voiceEnabled ? "Desativar voz" : "Ativar voz"}
                  data-testid="ai-voice-toggle-btn"
                >
                  {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
                onClick={() => setIsExpanded(p => !p)}
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

          <ScrollArea className="flex-1 px-4 py-3">
            <div>
              {messages.map(msg => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {chatMutation.isPending && <TypingIndicator />}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <div className="px-3 py-3 border-t border-border/50 shrink-0">
            <div className="flex items-end gap-2">
              {hasVoiceSupport && (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={isListening ? stopListening : startListening}
                  disabled={chatMutation.isPending}
                  title={isListening ? "Parar gravação" : "Falar com a IA"}
                  data-testid="ai-mic-btn"
                  className={cn(
                    "h-10 w-10 shrink-0 rounded-xl border-border/60 transition-all",
                    isListening
                      ? "bg-red-500 border-red-500 text-white hover:bg-red-600 animate-pulse"
                      : "hover:border-violet-400 hover:text-violet-600"
                  )}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
              <Textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? "🎤 Ouvindo..." : "Pergunte sobre trades, saldo, robô..."}
                className="resize-none min-h-[40px] max-h-[100px] text-sm rounded-xl border-border/60 focus-visible:ring-violet-500/50 bg-white text-black dark:bg-muted/40 dark:text-foreground placeholder:text-gray-400"
                rows={1}
                data-testid="ai-input"
                readOnly={isListening}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 hover:from-violet-500 hover:to-indigo-600 shadow-md"
                data-testid="ai-send-btn"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground/60 mt-1.5 text-center">
              {hasVoiceSupport ? "🎤 Fale ou digite · Enter para enviar" : "Enter para enviar · Shift+Enter nova linha"}
            </p>
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen(p => !p)}
        data-testid="ai-toggle-btn"
        className={cn(
          "relative flex items-center justify-center w-14 h-14 rounded-full shadow-xl transition-all duration-300",
          "bg-gradient-to-br from-violet-600 to-indigo-700 hover:from-violet-500 hover:to-indigo-600",
          "hover:scale-110 active:scale-95",
          isOpen && "ring-4 ring-violet-400/40"
        )}
        title={isOpen ? "Minimizar assistente" : "Abrir assistente de IA"}
      >
        <div
          className={cn(
            "transition-all duration-300",
            isOpen ? "opacity-100 scale-100" : "opacity-0 scale-0 absolute"
          )}
        >
          <X className="w-6 h-6 text-white" />
        </div>
        <div
          className={cn(
            "transition-all duration-300",
            !isOpen ? "opacity-100 scale-100" : "opacity-0 scale-0 absolute"
          )}
        >
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
  );
}
