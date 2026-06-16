"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, PieChart as PieIcon, MessageSquare, Clock, Star } from "lucide-react";

const MOCK_LINE_DATA = [
  { time: "06:00", today: 120, yesterday: 100 },
  { time: "09:00", today: 800, yesterday: 750 },
  { time: "12:00", today: 400, yesterday: 380 },
  { time: "15:00", today: 450, yesterday: 430 },
  { time: "18:00", today: 900, yesterday: 890 },
  { time: "21:00", today: 200, yesterday: 210 },
];

const MOCK_PIE_DATA = [
  { name: "Active", value: 42, color: "#10b981" },
  { name: "Idle", value: 6, color: "#f59e0b" },
  { name: "Maintenance", value: 2, color: "#ef4444" },
];

const MOCK_FEEDBACK = [
  { id: 1, route: "B101", rating: 5, comment: "On time and safe driving.", time: "10 mins ago" },
  { id: 2, route: "B205", rating: 4, comment: "AC wasn't very effective, but fast.", time: "1 hour ago" },
  { id: 3, route: "B108", rating: 2, comment: "Hard braking at Iskon stop.", time: "3 hours ago" },
];

export default function AnalyticsDashboard() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <div className="flex items-center gap-4 mb-10">
        <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center">
           <TrendingUp className="w-5 h-5 text-white/60" />
        </div>
        <h2 className="font-display text-2xl font-bold text-white tracking-tight">System Performance <span className="text-white/20">/ Live Feed</span></h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Pass Load Chart */}
        <div className="lg:col-span-2 bg-brand-surface rounded-[2rem] border border-white/5 p-8 h-80 shadow-2xl relative overflow-hidden">
           <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-[50px] pointer-events-none" />
           <h3 className="text-white/40 text-xs font-black uppercase tracking-[0.2em] mb-8">Passenger volume (Today vs Yesterday)</h3>
           <ResponsiveContainer width="100%" height="75%">
             <LineChart data={MOCK_LINE_DATA}>
               <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
               <XAxis dataKey="time" stroke="rgba(255,255,255,0.2)" fontSize={11} tickLine={false} axisLine={false} dy={10} />
               <YAxis stroke="rgba(255,255,255,0.2)" fontSize={11} tickLine={false} axisLine={false} />
               <Tooltip
                 contentStyle={{ backgroundColor: "#161618", borderColor: "rgba(255,255,255,0.05)", borderRadius: "16px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}
                 itemStyle={{ color: "#fff", fontWeight: "bold" }}
               />
               <Line type="monotone" dataKey="today" stroke="#fff" strokeWidth={3} dot={{ r: 0 }} activeDot={{ r: 6, strokeWidth: 0, fill: "#fff" }} />
               <Line type="monotone" dataKey="yesterday" stroke="#ffffff20" strokeWidth={2} strokeDasharray="5 5" dot={false} />
             </LineChart>
           </ResponsiveContainer>
        </div>

        {/* Fleet Status Chart */}
        <div className="bg-brand-surface rounded-[2rem] border border-white/5 p-8 h-80 flex flex-col shadow-2xl relative overflow-hidden">
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 blur-[50px] pointer-events-none" />
          <h3 className="text-white/40 text-xs font-black uppercase tracking-[0.2em] mb-4">Fleet Status Distribution</h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={MOCK_PIE_DATA} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={4} dataKey="value" stroke="none">
                  {MOCK_PIE_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} opacity={0.8} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#161618", borderColor: "rgba(255,255,255,0.05)", borderRadius: "16px" }}
                  itemStyle={{ color: "#fff", fontWeight: "bold" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Feedback Feed */}
      <div className="mt-10 bg-brand-surface rounded-[2rem] border border-white/5 p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
           <MessageSquare className="w-4 h-4 text-white/30" />
           <h3 className="text-white/40 text-xs font-black uppercase tracking-[0.2em]">Recent Passenger Feedback</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-[10px] text-white/20 uppercase tracking-[0.25em]">
                <th className="pb-5 px-2 font-black">Route</th>
                <th className="pb-5 px-2 font-black">Rating</th>
                <th className="pb-5 px-2 font-black">Comment</th>
                <th className="pb-5 px-2 font-black text-right">Age</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_FEEDBACK.map((fb) => (
                <tr key={fb.id} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-all group">
                  <td className="py-5 px-2 font-mono text-xs font-bold text-white/60">{fb.route}</td>
                  <td className="py-5 px-2">
                    <div className="flex gap-0.5">
                       {[...Array(5)].map((_, i) => (
                         <Star key={i} className={`w-3 h-3 ${i < fb.rating ? "fill-amber-500 text-amber-500" : "text-white/10"}`} />
                       ))}
                    </div>
                  </td>
                  <td className="py-5 px-2 text-sm text-white/70 group-hover:text-white transition-colors">{fb.comment}</td>
                  <td className="py-5 px-2 text-[10px] font-bold text-white/20 text-right uppercase tracking-widest">{fb.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
