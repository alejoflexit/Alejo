import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

// Gráficos de la pantalla Métricas, separados de App.js (09/11/2026) para que recharts y sus
// dependencias (~700KB) se descarguen solo cuando se abre Métricas y no frenen el resto de la app.
// Mismos colores que BRAND de App.js.
const BRAND = { border: "rgba(118, 174, 220, 0.18)", muted: "rgba(255,255,255,0.62)" };

export function GraficoTendencia({ data, ttStyle }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left:0, right:20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} />
        <XAxis dataKey="fecha" tick={{ fontSize:11, fill:BRAND.muted }} tickFormatter={v=>{ const p=v.split("-"); return `${p[2]}/${p[1]}`; }} />
        <YAxis domain={[0,100]} tickFormatter={v=>v+"%"} tick={{ fontSize:11, fill:BRAND.muted }} />
        <Tooltip contentStyle={ttStyle} formatter={v=>[v!==null?v.toFixed(1)+"%":"—","SLA Meli"]} labelFormatter={v=>{ const p=v.split("-"); return `${p[2]}/${p[1]}/${p[0]}`; }} />
        <Line type="monotone" dataKey="sla" stroke="#2EE6B6" strokeWidth={2.5} dot={{ fill:"#2EE6B6", r:5 }} activeDot={{ r:7 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GraficoComparativa({ data, ttStyle }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left:10, right:60 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={BRAND.border} />
        <XAxis type="number" domain={[0,100]} tickFormatter={v=>v+"%"} tick={{ fontSize:11, fill:BRAND.muted }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize:10, fill:BRAND.muted }} width={120} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={ttStyle} formatter={v=>[v.toFixed(1)+"%","SLA Meli"]} />
        <Bar dataKey="sla" radius={[0,4,4,0]} label={{ position:"right", formatter:v=>v.toFixed(0)+"%", fontSize:11, fill:BRAND.muted }}>
          {data.map((e,i)=><Cell key={i} fill={e.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GraficoSlaDia({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left:0, right:20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} />
        <XAxis dataKey="fecha" tick={{ fontSize:11, fill:BRAND.muted }} />
        <YAxis domain={[85,100]} tickFormatter={v=>v+"%"} tick={{ fontSize:11, fill:BRAND.muted }} />
        <Tooltip contentStyle={{ background:"#1A1A4A", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, fontSize:12, color:"#fff" }} formatter={v=>[v+"%","SLA"]} />
        <Line type="monotone" dataKey="sla" stroke="#2EE6B6" strokeWidth={2.5} dot={{ fill:"#2EE6B6", r:4 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
