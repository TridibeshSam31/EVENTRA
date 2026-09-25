"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Sliders, Shield, Zap, Database, Check, Cpu, Eye, Save, Calendar, MapPin, Users, Key, AlertTriangle, Terminal, Activity, Wifi, Lock } from 'lucide-react';

const TABS = [
  { id: 'general', label: 'Core Parameters', icon: Sliders },
  { id: 'modules', label: 'OS Modules', icon: Cpu },
  { id: 'access', label: 'Access Control', icon: Shield },
  { id: 'integrations', label: 'Integrations', icon: Database },
];

export default function SetupPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['> SYSTEM BOOT SEQUENCE INITIATED...', '> WAITING FOR USER CONFIGURATION...']);

  // State for toggles in modules
  const [modules, setModules] = useState({
    telemetry: true,
    recovery: false,
    rfid: true,
    drone: false
  });

  const [securityLevel, setSecurityLevel] = useState(3);

  const handleModuleToggle = (key: keyof typeof modules) => {
    setModules(p => {
       const newState = !p[key];
       addLog(`> MODULE [${key.toUpperCase()}] STATUS CHANGED TO: ${newState ? 'ONLINE' : 'OFFLINE'}`);
       if (newState) {
          setTimeout(() => addLog(`> CALIBRATING [${key.toUpperCase()}] SENSORS... OK`), 800);
       }
       return { ...p, [key]: newState };
    });
  };

  const addLog = (msg: string) => {
     setTerminalLogs(prev => [...prev.slice(-4), msg]);
  };

  const handleSave = () => {
    setSaving(true);
    addLog("> COMMITING CONFIGURATION TO MASTER LEDGER...");
    setTimeout(() => {
       setSaving(false);
       addLog("> CONFIGURATION SAVED SUCCESSFULLY. HASH: 0x89F2A1");
    }, 1500);
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-80px)] overflow-hidden p-4 md:p-8">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl md:text-4xl font-light tracking-tighter text-white flex items-center gap-3">
            <Settings className="text-[#D6003C] animate-[spin_10s_linear_infinite]" size={32} />
            System <span className="font-bold text-white">Configuration</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 ml-11">Define hardware limits, activate AI modules, and manage access layers.</p>
        </div>
        
        <div className="flex items-center gap-4">
           <div className="hidden md:flex flex-col items-end mr-4">
              <span className="text-[10px] font-mono text-green-500 tracking-widest uppercase">System Health: Nominal</span>
              <span className="text-[10px] font-mono text-gray-500 tracking-widest uppercase">Uptime: 99.98%</span>
           </div>
           <button 
             onClick={handleSave}
             disabled={saving}
             className="bg-[#D6003C] hover:bg-[#FF0D4A] text-white px-8 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(214,0,60,0.3)] flex items-center gap-2 w-full md:w-auto justify-center"
           >
             {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={16} />}
             {saving ? 'Encrypting...' : 'Commit Settings'}
           </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-8 min-h-0 overflow-hidden pb-20 xl:pb-0">
        
        {/* Left Column: Vertical Tabs & Mini Terminal */}
        <div className="xl:col-span-3 flex flex-col gap-6 h-full overflow-y-auto no-scrollbar">
           
           <div className="flex flex-col gap-2">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex items-center gap-4 px-6 py-4 rounded-2xl transition-all group overflow-hidden ${
                      isActive ? 'bg-white/10 text-white shadow-lg border border-white/10' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.02] border border-transparent'
                    }`}
                  >
                    {isActive && (
                      <motion.div 
                        layoutId="activeTabIndicator" 
                        className="absolute left-0 top-0 bottom-0 w-1 bg-[#D6003C]" 
                      />
                    )}
                    <tab.icon size={18} className={isActive ? 'text-[#D6003C]' : 'text-gray-500 group-hover:text-gray-400'} />
                    <span className="font-bold uppercase tracking-widest text-xs">{tab.label}</span>
                  </button>
                );
              })}
           </div>

           {/* Diagnostics Terminal */}
           <div className="flex-1 bg-[#050505] border border-white/5 rounded-2xl p-4 flex flex-col relative overflow-hidden min-h-[150px]">
              <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
              <h4 className="text-[9px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2 mb-3">
                 <Terminal size={12} /> Live Diagnostics
              </h4>
              <div className="flex-1 font-mono text-[10px] text-gray-400 flex flex-col justify-end gap-1.5 leading-relaxed">
                 <AnimatePresence>
                    {terminalLogs.map((log, i) => (
                       <motion.div 
                         key={i + log}
                         initial={{ opacity: 0, x: -10 }}
                         animate={{ opacity: 1, x: 0 }}
                         className={log.includes('ONLINE') || log.includes('OK') || log.includes('SUCCESS') ? 'text-green-400' : log.includes('OFFLINE') ? 'text-gray-500' : 'text-blue-400'}
                       >
                          {log}
                       </motion.div>
                    ))}
                 </AnimatePresence>
                 <div className="w-2 h-3 bg-white/50 animate-pulse mt-1" />
              </div>
           </div>
        </div>

        {/* Right Column: Configuration Panes */}
        <div className="xl:col-span-9 h-full bg-[#0B0B0F] border border-white/5 rounded-[2rem] shadow-2xl relative overflow-hidden flex flex-col">
           {/* Cyber Grid Background */}
           <div className="absolute inset-0 bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:40px_40px] opacity-[0.02] pointer-events-none" />
           <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[100px] pointer-events-none translate-x-1/3 -translate-y-1/3" />
           
           <div className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar relative z-10">
              <AnimatePresence mode="wait">
                
                {/* --- GENERAL TAB --- */}
                {activeTab === 'general' && (
                  <motion.div 
                    key="general"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="max-w-4xl space-y-10"
                  >
                     {/* Identity Section */}
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        <div>
                           <h2 className="text-xl font-light text-white mb-2 flex items-center gap-2"><MapPin size={18} className="text-blue-500"/> Core Identity</h2>
                           <p className="text-sm text-gray-500 mb-6">Master parameters for the deployment.</p>
                           
                           <div className="space-y-6">
                              <div>
                                 <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Project Designation</label>
                                 <input 
                                   type="text" 
                                   defaultValue="Global Tech Summit '26"
                                   className="w-full bg-black/50 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/50 transition-all font-medium backdrop-blur-md"
                                 />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                   <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Start Date</label>
                                   <input 
                                     type="date" 
                                     defaultValue="2026-10-15"
                                     className="w-full bg-black/50 border border-white/10 text-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/50 transition-all font-mono text-sm"
                                   />
                                </div>
                                <div>
                                   <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-2">End Date</label>
                                   <input 
                                     type="date" 
                                     defaultValue="2026-10-18"
                                     className="w-full bg-black/50 border border-white/10 text-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/50 transition-all font-mono text-sm"
                                   />
                                </div>
                              </div>
                           </div>
                        </div>

                        {/* Constraints Section */}
                        <div>
                           <h2 className="text-xl font-light text-white mb-2 flex items-center gap-2"><Lock size={18} className="text-[#D6003C]"/> Hard Constraints</h2>
                           <p className="text-sm text-gray-500 mb-6">Limits that dictate alert thresholds.</p>
                           
                           <div className="space-y-6">
                              <div>
                                 <div className="flex justify-between items-end mb-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Security Clearance Level</label>
                                    <span className="text-xs font-mono text-[#D6003C]">Tier {securityLevel}</span>
                                 </div>
                                 <input 
                                   type="range" min="1" max="5" 
                                   value={securityLevel}
                                   onChange={(e) => setSecurityLevel(parseInt(e.target.value))}
                                   className="w-full accent-[#D6003C]"
                                 />
                                 <div className="flex justify-between text-[9px] text-gray-600 mt-1 uppercase font-bold tracking-widest">
                                    <span>Standard</span>
                                    <span>Military</span>
                                 </div>
                              </div>
                              
                              <div>
                                 <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Max Fire Code Capacity</label>
                                 <div className="relative">
                                    <Users size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                                    <input 
                                      type="number" 
                                      defaultValue={5000}
                                      className="w-full bg-black/50 border border-white/10 text-white rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-[#D6003C]/50 transition-all font-mono"
                                    />
                                 </div>
                              </div>
                           </div>
                        </div>
                     </div>
                  </motion.div>
                )}

                {/* --- MODULES TAB --- */}
                {activeTab === 'modules' && (
                  <motion.div 
                    key="modules"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-8"
                  >
                     <div className="flex justify-between items-end mb-8">
                        <div>
                           <h2 className="text-2xl font-light text-white mb-2">Hardware & AI Modules</h2>
                           <p className="text-sm text-gray-500">Toggle operational subsystems. Rack space: 4/4 slots available.</p>
                        </div>
                        <div className="text-right">
                           <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block">Active Systems</span>
                           <span className="text-2xl font-mono text-white">{Object.values(modules).filter(Boolean).length}/4</span>
                        </div>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        
                        {/* Module: Telemetry */}
                        <div className={`relative p-6 rounded-[2rem] border transition-all overflow-hidden ${modules.telemetry ? 'bg-blue-500/5 border-blue-500/30' : 'bg-black/50 border-white/5'}`}>
                           {modules.telemetry && <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 rounded-full blur-[50px]" />}
                           
                           <div className="flex justify-between items-start mb-6 relative z-10">
                              <div className="flex items-center gap-4">
                                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${modules.telemetry ? 'bg-blue-500/20 text-blue-400 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-white/5 text-gray-600 border-white/10'}`}>
                                    <Eye size={24} />
                                 </div>
                                 <div>
                                    <h3 className={`text-lg font-bold tracking-tight ${modules.telemetry ? 'text-white' : 'text-gray-400'}`}>Crowd Telemetry</h3>
                                    <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500">AI Computer Vision</span>
                                 </div>
                              </div>
                              <button onClick={() => handleModuleToggle('telemetry')} className={`w-14 h-7 rounded-full transition-colors flex items-center px-1 ${modules.telemetry ? 'bg-blue-500' : 'bg-gray-800'}`}>
                                 <motion.div layout className="w-5 h-5 bg-white rounded-full shadow-sm" animate={{ x: modules.telemetry ? 28 : 0 }} />
                              </button>
                           </div>
                           <p className="text-sm text-gray-400 relative z-10">Real-time density heatmaps and footfall tracking across all mapped zones. Requires IP camera integration.</p>
                           
                           {modules.telemetry && (
                              <div className="mt-4 pt-4 border-t border-blue-500/20 flex justify-between items-center text-[10px] font-mono text-blue-400 uppercase">
                                 <span className="flex items-center gap-2"><Wifi size={12}/> Ping: 14ms</span>
                                 <span>Sensors: 24/24 Online</span>
                              </div>
                           )}
                        </div>

                        {/* Module: Smart Recovery */}
                        <div className={`relative p-6 rounded-[2rem] border transition-all overflow-hidden ${modules.recovery ? 'bg-[#D6003C]/5 border-[#D6003C]/30' : 'bg-black/50 border-white/5'}`}>
                           {modules.recovery && <div className="absolute top-0 right-0 w-32 h-32 bg-[#D6003C]/20 rounded-full blur-[50px]" />}
                           
                           <div className="flex justify-between items-start mb-6 relative z-10">
                              <div className="flex items-center gap-4">
                                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${modules.recovery ? 'bg-[#D6003C]/20 text-[#D6003C] border-[#D6003C]/30 shadow-[0_0_15px_rgba(214,0,60,0.3)]' : 'bg-white/5 text-gray-600 border-white/10'}`}>
                                    <Zap size={24} />
                                 </div>
                                 <div>
                                    <h3 className={`text-lg font-bold tracking-tight ${modules.recovery ? 'text-white' : 'text-gray-400'}`}>Smart Recovery AI</h3>
                                    <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500">Autonomous Execution</span>
                                 </div>
                              </div>
                              <button onClick={() => handleModuleToggle('recovery')} className={`w-14 h-7 rounded-full transition-colors flex items-center px-1 ${modules.recovery ? 'bg-[#D6003C]' : 'bg-gray-800'}`}>
                                 <motion.div layout className="w-5 h-5 bg-white rounded-full shadow-sm" animate={{ x: modules.recovery ? 28 : 0 }} />
                              </button>
                           </div>
                           <p className="text-sm text-gray-400 relative z-10">Allows the system to autonomously generate and recommend disaster recovery playbooks for vendor failures.</p>
                           
                           {modules.recovery && (
                              <div className="mt-4 pt-4 border-t border-[#D6003C]/20 flex justify-between items-center text-[10px] font-mono text-[#D6003C] uppercase">
                                 <span className="flex items-center gap-2"><Activity size={12}/> Model: GPT-4.5</span>
                                 <span>Confidence: 98.2%</span>
                              </div>
                           )}
                        </div>

                        {/* Module: RFID */}
                        <div className={`relative p-6 rounded-[2rem] border transition-all overflow-hidden ${modules.rfid ? 'bg-purple-500/5 border-purple-500/30' : 'bg-black/50 border-white/5'}`}>
                           {modules.rfid && <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/20 rounded-full blur-[50px]" />}
                           
                           <div className="flex justify-between items-start mb-6 relative z-10">
                              <div className="flex items-center gap-4">
                                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${modules.rfid ? 'bg-purple-500/20 text-purple-400 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'bg-white/5 text-gray-600 border-white/10'}`}>
                                    <Scan size={24} />
                                 </div>
                                 <div>
                                    <h3 className={`text-lg font-bold tracking-tight ${modules.rfid ? 'text-white' : 'text-gray-400'}`}>RFID Smart Gates</h3>
                                    <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500">Physical Hardware</span>
                                 </div>
                              </div>
                              <button onClick={() => handleModuleToggle('rfid')} className={`w-14 h-7 rounded-full transition-colors flex items-center px-1 ${modules.rfid ? 'bg-purple-500' : 'bg-gray-800'}`}>
                                 <motion.div layout className="w-5 h-5 bg-white rounded-full shadow-sm" animate={{ x: modules.rfid ? 28 : 0 }} />
                              </button>
                           </div>
                           <p className="text-sm text-gray-400 relative z-10">Integrates with physical venue gates for seamless check-in and zone access control via wristbands.</p>
                           
                           {modules.rfid && (
                              <div className="mt-4 pt-4 border-t border-purple-500/20 flex justify-between items-center text-[10px] font-mono text-purple-400 uppercase">
                                 <span className="flex items-center gap-2"><Wifi size={12}/> Ping: 8ms</span>
                                 <span>Gates: 12/12 Online</span>
                              </div>
                           )}
                        </div>

                        {/* Module: Drone */}
                        <div className={`relative p-6 rounded-[2rem] border transition-all overflow-hidden ${modules.drone ? 'bg-yellow-500/5 border-yellow-500/30' : 'bg-black/50 border-white/5'}`}>
                           {modules.drone && <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/20 rounded-full blur-[50px]" />}
                           
                           <div className="flex justify-between items-start mb-6 relative z-10">
                              <div className="flex items-center gap-4">
                                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${modules.drone ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'bg-white/5 text-gray-600 border-white/10'}`}>
                                    <Crosshair size={24} />
                                 </div>
                                 <div>
                                    <h3 className={`text-lg font-bold tracking-tight ${modules.drone ? 'text-white' : 'text-gray-400'}`}>Aero-Surveillance</h3>
                                    <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500">Drone Fleet Ops</span>
                                 </div>
                              </div>
                              <button onClick={() => handleModuleToggle('drone')} className={`w-14 h-7 rounded-full transition-colors flex items-center px-1 ${modules.drone ? 'bg-yellow-500' : 'bg-gray-800'}`}>
                                 <motion.div layout className="w-5 h-5 bg-white rounded-full shadow-sm" animate={{ x: modules.drone ? 28 : 0 }} />
                              </button>
                           </div>
                           <p className="text-sm text-gray-400 relative z-10">Automated aerial drone dispatch for perimeter sweeps and outdoor emergency visual confirmation.</p>
                           
                           {modules.drone && (
                              <div className="mt-4 pt-4 border-t border-yellow-500/20 flex justify-between items-center text-[10px] font-mono text-yellow-500 uppercase">
                                 <span className="flex items-center gap-2"><Activity size={12}/> Airspace: CLEAR</span>
                                 <span>Drones: 4 Ready</span>
                              </div>
                           )}
                        </div>

                     </div>
                  </motion.div>
                )}

                {/* --- ACCESS TAB --- */}
                {activeTab === 'access' && (
                  <motion.div 
                    key="access"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="max-w-4xl space-y-8"
                  >
                     <div className="flex justify-between items-end mb-6">
                        <div>
                           <h2 className="text-2xl font-light text-white mb-2">Access & Cryptography</h2>
                           <p className="text-sm text-gray-500">Manage which personnel hold the keys to override the system.</p>
                        </div>
                        <button className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-white/10 transition-all">
                           + Add Operative
                        </button>
                     </div>

                     <div className="bg-black/50 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-md">
                        <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/10 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                           <div className="col-span-4">Operative Identity</div>
                           <div className="col-span-3">Clearance Level</div>
                           <div className="col-span-3">Key Fingerprint</div>
                           <div className="col-span-2 text-right">Status</div>
                        </div>
                        
                        {[
                          { name: 'David M.', role: 'Executive Command', lvl: 'Level 5 (God Mode)', key: '0x8f4...e2b1', status: 'ACTIVE' },
                          { name: 'Sarah K.', role: 'Logistics Lead', lvl: 'Level 3 (Ops)', key: '0x3c2...9a7f', status: 'ACTIVE' },
                          { name: 'Agent 4', role: 'Security Chief', lvl: 'Level 4 (Sec)', key: '0x99f...11c4', status: 'LOCKED' },
                        ].map((user, i) => (
                          <div key={i} className="grid grid-cols-12 gap-4 p-4 border-b border-white/5 items-center hover:bg-white/[0.02] transition-colors">
                             <div className="col-span-4 flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                                   <UserCircle2 size={16} className="text-gray-400" />
                                </div>
                                <div>
                                   <div className="text-sm font-medium text-white">{user.name}</div>
                                   <div className="text-[10px] text-gray-500 uppercase tracking-widest">{user.role}</div>
                                </div>
                             </div>
                             <div className="col-span-3">
                                <span className="text-xs text-blue-400 border border-blue-400/20 bg-blue-400/10 px-2 py-1 rounded">{user.lvl}</span>
                             </div>
                             <div className="col-span-3 font-mono text-xs text-gray-500">
                                {user.key}
                             </div>
                             <div className="col-span-2 text-right">
                                <span className={`text-[10px] font-bold uppercase tracking-widest ${user.status === 'ACTIVE' ? 'text-green-500' : 'text-[#D6003C]'}`}>
                                   {user.status}
                                </span>
                             </div>
                          </div>
                        ))}
                     </div>
                  </motion.div>
                )}

                {/* --- INTEGRATIONS TAB --- */}
                {activeTab === 'integrations' && (
                  <motion.div 
                    key="integrations"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="max-w-4xl space-y-8"
                  >
                     <div>
                        <h2 className="text-2xl font-light text-white mb-2">External API Pipelines</h2>
                        <p className="text-sm text-gray-500">Connect third-party infrastructure to Eventra OS.</p>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {[
                           { name: 'Stripe', desc: 'Financial transaction & refund processing.', status: 'Connected', color: 'bg-indigo-500' },
                           { name: 'Slack', desc: 'Emergency push alerts to staff channels.', status: 'Connected', color: 'bg-green-500' },
                           { name: 'Salesforce', desc: 'VIP attendee CRM sync.', status: 'Disconnected', color: 'bg-blue-400' },
                           { name: 'Twilio', desc: 'Mass SMS broadcasting for crowd control.', status: 'Connected', color: 'bg-[#D6003C]' }
                        ].map(api => (
                           <div key={api.name} className="p-6 bg-black/50 border border-white/10 rounded-2xl flex items-center justify-between group hover:border-white/20 transition-all backdrop-blur-md">
                              <div className="flex items-center gap-4">
                                 <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                                    <Database size={20} className="text-gray-400" />
                                 </div>
                                 <div>
                                    <h4 className="text-white font-medium mb-1">{api.name}</h4>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">{api.desc}</p>
                                 </div>
                              </div>
                              <button className={`text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-xl transition-all ${
                                api.status === 'Connected' 
                                  ? 'bg-transparent text-gray-500 border border-transparent hover:text-[#D6003C] hover:border-[#D6003C]/30' 
                                  : 'bg-white text-black'
                              }`}>
                                 {api.status === 'Connected' ? 'Disconnect' : 'Connect'}
                              </button>
                           </div>
                        ))}
                     </div>
                  </motion.div>
                )}

              </AnimatePresence>
           </div>
        </div>

      </div>
    </div>
  );
}

// Temporary icons
const Scan = ({ size, className }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const Crosshair = ({ size, className }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="22" y1="12" x2="18" y2="12" />
    <line x1="6" y1="12" x2="2" y2="12" />
    <line x1="12" y1="6" x2="12" y2="2" />
    <line x1="12" y1="22" x2="12" y2="18" />
  </svg>
);

const UserCircle2 = ({ size, className }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="10" r="3" />
    <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
  </svg>
);
