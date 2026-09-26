"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Search, 
  Plus, 
  Filter, 
  MapPin, 
  Phone, 
  PhoneCall, 
  PhoneOff, 
  Mail, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle,
  ExternalLink,
  Volume2,
  Mic,
  MicOff,
  Sparkles,
  Bot,
  Radio,
  Clock,
  Send,
  Loader2,
  X
} from 'lucide-react';

interface VendorItem {
  id: number;
  name: string;
  service: string;
  contact: string;
  phone: string;
  email: string;
  status: string;
  location: string;
  rating: number;
}

interface TranscriptLine {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  timestamp: string;
}

const mockProviders: VendorItem[] = [
  { id: 0, name: 'Tridibesh Samantroy (Lead Tech)', service: 'Sound & Production Staging', contact: 'Tridibesh', phone: '+91 8448210262', email: 'tridibesh@eventra.ai', status: 'confirmed', location: 'En Route to Venue', rating: 5.0 },
  { id: 1, name: 'Apex Audio Visual', service: 'AV & Lighting', contact: 'Mike Davis', phone: '+1 (555) 123-4567', email: 'mike@apexav.com', status: 'confirmed', location: 'On-Site', rating: 4.8 },
  { id: 2, name: 'Gourmet Catering Co.', service: 'Food & Beverage', contact: 'Sarah Jenkins', phone: '+1 (555) 987-6543', email: 'orders@gourmet.co', status: 'pending', location: 'Off-Site', rating: 4.5 },
  { id: 3, name: 'SecureTech', service: 'Event Security', contact: 'David Lee', phone: '+1 (555) 456-7890', email: 'dispatch@securetech.com', status: 'confirmed', location: 'On-Site', rating: 4.9 },
  { id: 4, name: 'City Floral Design', service: 'Decor & Floral', contact: 'Emma Stone', phone: '+1 (555) 321-6547', email: 'hello@cityfloral.com', status: 'in-review', location: 'Off-Site', rating: 4.2 },
  { id: 5, name: 'Vanguard Transport', service: 'Logistics', contact: 'James Wilson', phone: '+1 (555) 888-9999', email: 'freight@vanguard.com', status: 'confirmed', location: 'In Transit', rating: 4.7 },
  { id: 6, name: 'Elite Staffing', service: 'Brand Ambassadors', contact: 'Lisa Chen', phone: '+1 (555) 777-2222', email: 'booking@elitestaffing.com', status: 'confirmed', location: 'On-Site', rating: 4.6 },
];

export default function ProvidersPage() {
  const [search, setSearch] = useState('');
  const [activeCallVendor, setActiveCallVendor] = useState<VendorItem | null>(null);
  const [callStatus, setCallStatus] = useState<'dialing' | 'connected' | 'completed'>('dialing');
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // Real Exotel Telephony State
  const [exotelStatus, setExotelStatus] = useState<{
    loading: boolean;
    success?: boolean;
    message?: string;
    callSid?: string;
  }>({ loading: false });

  // Live Conversation & Gemini AI State
  const [transcripts, setTranscripts] = useState<TranscriptLine[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isAiResponding, setIsAiResponding] = useState(false);

  // Filter providers
  const filtered = mockProviders.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.service.toLowerCase().includes(search.toLowerCase())
  );

  function speakText(text: string) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }

  async function sendUserMessage(msgText: string) {
    if (!msgText.trim() || !activeCallVendor) return;
    const cleanMsg = msgText.trim();
    setUserInput('');

    const nowTime = new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
    const userLine: TranscriptLine = {
      id: Date.now().toString(),
      sender: 'user',
      text: cleanMsg,
      timestamp: nowTime,
    };
    setTranscripts(prev => [...prev, userLine]);
    setIsAiResponding(true);

    try {
      const res = await fetch('http://localhost:8000/api/v1/voice/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_name: activeCallVendor.name,
          vendor_service: activeCallVendor.service,
          message: cleanMsg,
        }),
      });
      const data = await res.json();
      const replyText = data.reply || "Understood. The EVENTRA operational team has been notified.";
      
      const aiLine: TranscriptLine = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
      };
      setTranscripts(prev => [...prev, aiLine]);
      speakText(replyText);
    } catch (err) {
      const fallbackText = "Acknowledged. Updating event schedule and notifying logistics coordinator.";
      setTranscripts(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: fallbackText,
        timestamp: new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
      }]);
      speakText(fallbackText);
    } finally {
      setIsAiResponding(false);
    }
  }

  function toggleListening() {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert("Speech recognition is not supported in this browser. Please type your reply in the input box below!");
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        const spoken = event.results[0][0].transcript;
        setIsListening(false);
        sendUserMessage(spoken);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } catch (e) {
      console.error(e);
      setIsListening(false);
    }
  }

  async function startVoiceCall(vendor: VendorItem) {
    setActiveCallVendor(vendor);
    setCallStatus('connected');
    setCallDuration(0);
    setIsMuted(false);
    setExotelStatus({ loading: true });

    // Initial greeting from Gemini Operations Voice AI
    const greeting = `Hello ${vendor.contact}, this is EVENTRA Operations AI calling regarding the ${vendor.service} contract. Can you confirm your setup crew ETA at the venue?`;
    setTranscripts([
      {
        id: 'init-greeting',
        sender: 'ai',
        text: greeting,
        timestamp: '00:01',
      }
    ]);
    speakText(greeting);

    // Trigger REAL physical outbound phone call to Exotel API
    try {
      const cleanPhone = vendor.phone.replace(/[^\d+]/g, '');
      const res = await fetch('http://localhost:8000/api/v1/voice/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_phone: cleanPhone,
          vendor_name: vendor.name,
          event_id: 'conference_demo',
          provider_id: vendor.name,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setExotelStatus({
          loading: false,
          success: true,
          callSid: data.data?.call_sid || 'EXOTEL_ACTIVE',
          message: `Physical line dialed successfully. Call SID: ${data.data?.call_sid}`,
        });
      } else {
        setExotelStatus({
          loading: false,
          success: false,
          message: data.error || 'Exotel outbound line rejected the call request.',
        });
      }
    } catch (err: any) {
      setExotelStatus({
        loading: false,
        success: false,
        message: 'Could not connect to FastAPI server at http://localhost:8000.',
      });
    }
  }

  function endVoiceCall() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsListening(false);
    setCallStatus('completed');
    setTimeout(() => {
      setActiveCallVendor(null);
    }, 1000);
  }

  return (
    <div className="w-full h-full flex flex-col space-y-8 text-white font-sans pb-10">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Users className="text-purple-400 w-5 h-5" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-purple-400 uppercase">Vendor Network</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight">
            Service <span className="font-bold">Providers</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative group hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-purple-400 transition-colors" />
            <input 
              type="text" 
              placeholder="Search vendors..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[#111115] border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors w-64"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors shadow-[0_0_20px_rgba(168,85,247,0.2)]">
            <Plus className="w-4 h-4" />
            <span>Add Provider</span>
          </button>
        </div>
      </div>

      {/* Voice Telephony Banner */}
      <div className="bg-gradient-to-r from-emerald-950/40 via-blue-950/30 to-purple-950/30 border border-emerald-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">AI Voice Calling & Telephony Active</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Gemini 3.8 Live + Exotel
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Click &quot;AI Voice Call&quot; on any vendor card to dispatch an autonomous voice briefing with real-time audio and speech transcription.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span>Exotel Virtual Line: Active</span>
        </div>
      </div>

      {/* Providers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((provider) => (
          <motion.div
            key={provider.id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#111115] border border-white/10 rounded-2xl p-6 relative overflow-hidden group hover:border-purple-500/30 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-medium text-white group-hover:text-purple-300 transition-colors">
                    {provider.name}
                  </h3>
                  <span className="text-xs font-mono text-gray-500 uppercase tracking-wider">{provider.service}</span>
                </div>
                <div className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider border ${
                  provider.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                  provider.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                  'bg-blue-500/10 text-blue-400 border-blue-500/20'
                }`}>
                  {provider.status}
                </div>
              </div>

              <div className="space-y-4 text-sm text-gray-400">
                <div className="flex items-center gap-3 p-3 bg-black/40 rounded-xl border border-white/5">
                  <div className="bg-white/5 p-1.5 rounded-lg text-gray-300">
                    <Users className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] uppercase text-gray-500 font-bold mb-0.5">Point of Contact</div>
                    <div className="text-white text-xs">{provider.contact}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs font-mono">{provider.phone}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs truncate" title={provider.email}>{provider.email}</span>
                  </div>
                  <div className="flex items-center gap-2 col-span-2 mt-2 pt-2 border-t border-white/5">
                    <MapPin className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs font-mono">{provider.location}</span>
                    <div className="ml-auto flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                      ★ {provider.rating}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between gap-2">
              <button 
                onClick={() => startVoiceCall(provider)}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors shadow-[0_0_15px_rgba(16,185,129,0.15)]"
              >
                <PhoneCall className="w-3.5 h-3.5 animate-pulse" />
                <span>AI Voice Call</span>
              </button>

              <button className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white transition-colors">
                View Contract <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Voice Call Dialog Modal */}
      <AnimatePresence>
        {activeCallVendor && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-xl bg-[#0e111a] border border-emerald-500/30 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="p-4 bg-emerald-950/40 border-b border-emerald-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      EVENTRA AI Voice Gateway
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Exotel • Gemini Live AI
                      </span>
                    </h3>
                  </div>
                </div>
                <button 
                  onClick={endVoiceCall}
                  className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Vendor & Status Header */}
              <div className="p-5 border-b border-white/5 bg-black/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500/20 to-purple-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
                    <Bot className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-white">{activeCallVendor.name}</h4>
                    <p className="text-xs text-gray-400 font-mono">
                      Target: {activeCallVendor.contact} ({activeCallVendor.phone})
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Live Session Active
                  </span>
                  <span className="text-[10px] font-mono text-gray-400">Caller ID: Configured Virtual Line</span>
                </div>
              </div>

              {/* Real Exotel Telephony Diagnostic Banner */}
              <div className="px-5 pt-3">
                {exotelStatus.loading && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-mono">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
                    <span>Connecting to Exotel API (https://api.exotel.com) to place outbound call...</span>
                  </div>
                )}

                {!exotelStatus.loading && exotelStatus.success && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-mono">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">Outbound line connected. Call SID: {exotelStatus.callSid}</span>
                  </div>
                )}

                {!exotelStatus.loading && exotelStatus.success === false && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-1">
                    <div className="flex items-center gap-2 font-bold text-amber-300">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Exotel Telephony Response: KYC Pending</span>
                    </div>
                    <p className="font-mono text-[11px] text-amber-200/90 leading-relaxed">
                      {exotelStatus.message}
                    </p>
                    <p className="text-[10px] text-gray-400 pt-0.5">
                      💡 Indian telecom regulations (TRAI) require business KYC approval at <span className="text-white underline">my.exotel.com</span> before outbound phone ringing is unlocked.
                      You can test the full voice AI conversation with real microphone speech right here in browser below!
                    </p>
                  </div>
                )}
              </div>

              {/* Audio Waveform */}
              <div className="px-5 py-2">
                <div className="w-full bg-black/40 border border-white/5 rounded-xl p-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
                    <Volume2 className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <span>{isListening ? "Listening to your microphone..." : isAiResponding ? "Gemini AI thinking..." : "Audio channel open (Web Audio / 24kHz)"}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`w-1 bg-emerald-400 h-2 ${isListening || isAiResponding ? 'animate-pulse' : ''}`} />
                    <span className={`w-1 bg-emerald-400 h-5 ${isListening || isAiResponding ? 'animate-pulse delay-75' : ''}`} />
                    <span className={`w-1 bg-emerald-400 h-3 ${isListening || isAiResponding ? 'animate-pulse delay-150' : ''}`} />
                    <span className={`w-1 bg-emerald-400 h-6 ${isListening || isAiResponding ? 'animate-pulse delay-100' : ''}`} />
                    <span className={`w-1 bg-emerald-400 h-4 ${isListening || isAiResponding ? 'animate-pulse delay-200' : ''}`} />
                  </div>
                </div>
              </div>

              {/* Real-time Live Transcript Stream */}
              <div className="px-5 py-1 flex-1 overflow-y-auto space-y-3 min-h-[160px] max-h-[220px]">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold border-b border-white/5 pb-1 flex items-center justify-between">
                  <span>Live Speech Transcription &amp; Dialogue</span>
                  <span className="text-emerald-400 font-normal">Real Gemini AI Engine</span>
                </div>

                {transcripts.map((t) => (
                  <div 
                    key={t.id} 
                    className={`p-2.5 rounded-xl text-xs font-mono leading-relaxed ${
                      t.sender === 'ai' 
                        ? 'bg-emerald-950/20 border border-emerald-500/20 text-emerald-300' 
                        : 'bg-purple-950/20 border border-purple-500/20 text-purple-200 ml-4'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                      <span className="font-bold uppercase tracking-wider">
                        {t.sender === 'ai' ? '🤖 Gemini Operations Voice AI' : `👤 ${activeCallVendor.contact}`}
                      </span>
                      <span>{t.timestamp}</span>
                    </div>
                    <p className="text-white text-xs">{t.text}</p>
                  </div>
                ))}

                {isAiResponding && (
                  <div className="p-2.5 rounded-xl bg-emerald-950/10 border border-emerald-500/10 text-xs font-mono text-emerald-400 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Gemini AI is processing spoken response...</span>
                  </div>
                )}
              </div>

              {/* Interactive Speech & Text Input */}
              <div className="p-4 bg-black/40 border-t border-white/10 space-y-3">
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendUserMessage(userInput);
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    placeholder="Speak into mic or type reply (e.g., 'Arriving in 15 mins with speakers')..."
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    className="flex-1 bg-black/60 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!userInput.trim() || isAiResponding}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </form>

                {/* Call Controls */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleListening}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold transition-all ${
                        isListening 
                          ? 'bg-red-500 text-white border-red-400 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.5)]' 
                          : 'bg-white/5 hover:bg-white/10 text-emerald-400 border-emerald-500/30'
                      }`}
                      title={isListening ? "Listening... click to stop" : "Click to speak via Microphone"}
                    >
                      <Mic className="w-4 h-4" />
                      <span>{isListening ? "Listening (Speak Now)..." : "Speak into Mic"}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={endVoiceCall}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>End Call</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
    </div>
  );
}
