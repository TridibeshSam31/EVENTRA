"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";

// Isometric diamond geometry (SVG units). Every label and leader line is
// computed from the same projection, so they always stay attached to the layers.
const CX = 300;
const HW = 190; // half width of a layer
const HH = 95; // half height of a layer
const BASE_Y = 400; // centre of the bottom layer
const GAP = 72; // vertical distance between layers
const DEPTH = 8; // visible thickness of each slab

const layerY = (i: number) => BASE_Y - i * GAP;

/** Maps a point on a layer (u, v in 0..1) to SVG coordinates. */
function iso(i: number, u: number, v: number): [number, number] {
  const cy = layerY(i);
  return [CX + (u - v) * HW, cy - HH + (u + v) * HH];
}

const pts = (list: [number, number][]) => list.map(([x, y]) => `${x},${y}`).join(" ");

function gridLines(i: number, n: number) {
  const lines: { a: [number, number]; b: [number, number] }[] = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    lines.push({ a: iso(i, t, 0), b: iso(i, t, 1) });
    lines.push({ a: iso(i, 0, t), b: iso(i, 1, t) });
  }
  return lines;
}

const LAYERS = [
  { fill: "#F4F1EB", stroke: "#CFC8BC", side: "#DED8CE", grid: "#E4DFD6", cells: 4 },
  { fill: "#F8F6F2", stroke: "#BCB4A7", side: "#E6E1D8", grid: "#E8E3DA", cells: 3 },
  { fill: "#FFFFFF", stroke: "#A49C8F", side: "#EBE6DE", grid: "#F0EDE7", cells: 5 },
  { fill: "#FFFFFF", stroke: "#D6003C", side: "#F4C7D3", grid: "rgba(214,0,60,0.12)", cells: 2 },
];

function Slab({ i }: { i: number }) {
  const L = LAYERS[i];
  const top = iso(i, 0, 0);
  const right = iso(i, 1, 0);
  const bottom = iso(i, 1, 1);
  const left = iso(i, 0, 1);
  const down = (p: [number, number]): [number, number] => [p[0], p[1] + DEPTH];
  return (
    <g>
      {/* soft drop shadow */}
      <polygon points={pts([top, right, bottom, left].map(([x, y]) => [x - 10, y + 14] as [number, number]))} fill="rgba(0,0,0,0.05)" />
      {/* slab sides */}
      <polygon points={pts([left, bottom, down(bottom), down(left)])} fill={L.side} />
      <polygon points={pts([bottom, right, down(right), down(bottom)])} fill={L.side} opacity={0.75} />
      {/* top face */}
      <polygon points={pts([top, right, bottom, left])} fill={L.fill} stroke={L.stroke} strokeWidth={1.5} />
      {gridLines(i, L.cells).map((g, k) => (
        <line key={k} x1={g.a[0]} y1={g.a[1]} x2={g.b[0]} y2={g.b[1]} stroke={L.grid} strokeWidth={1} />
      ))}
    </g>
  );
}

// Anchor points on the layers for the annotations.
const HUB = iso(3, 0.5, 0.5);
const RECOVERY = iso(3, 0.15, 0.15);
const SPOKES = [iso(3, 0.15, 0.15), iso(3, 0.85, 0.15), iso(3, 0.85, 0.85)];
// Only the front strip of the lower layers is visible, so their anchors sit there.
const TELEMETRY_NODES = [iso(1, 0.3, 0.95), iso(1, 0.7, 0.95), iso(1, 0.95, 0.7)];
const APPROVAL = iso(0, 0.8, 0.55);

function Annotation({
  anchor,
  label,
  sub,
  color,
  side,
  labelY,
}: {
  anchor: [number, number];
  label: string;
  sub: string;
  color: string;
  side: "left" | "right";
  labelY: number;
}) {
  const elbowX = side === "right" ? 520 : 80;
  const textX = side === "right" ? elbowX + 8 : elbowX - 8;
  const anchorText = side === "right" ? "start" : "end";
  return (
    <g>
      <polyline
        points={pts([anchor, [anchor[0], labelY], [elbowX, labelY]])}
        fill="none"
        stroke="#B2AA9D"
        strokeWidth={1}
      />
      <circle cx={anchor[0]} cy={anchor[1]} r={4} fill={color} />
      <text x={textX} y={labelY - 4} textAnchor={anchorText} fontSize={19} fontWeight={700} fill="#1B1815">
        {label}
      </text>
      <text x={textX} y={labelY + 17} textAnchor={anchorText} fontSize={12} letterSpacing="1" fill={color} fontFamily="ui-monospace, monospace">
        {sub}
      </text>
    </g>
  );
}

export default function IsometricStack() {
  const reduce = useReducedMotion();

  return (
    <motion.svg
      viewBox="-130 30 820 500"
      className="w-full max-w-[860px] h-auto overflow-visible select-none"
      role="img"
      aria-label="Four-layer EVENTRA architecture: approvals, discovery, operations and smart recovery"
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.4 }}
    >
      {/* Layers assemble bottom-up */}
      {LAYERS.map((_, i) => (
        <motion.g
          key={i}
          variants={{
            hidden: { opacity: 0, y: reduce ? 0 : -60 - i * 25 },
            shown: { opacity: 1, y: 0 },
          }}
          transition={{ duration: 0.7, delay: i * 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <Slab i={i} />

          {i === 1 && (
            <g>
              <polyline points={pts(TELEMETRY_NODES)} fill="none" stroke="#4C6DE4" strokeWidth={2} strokeDasharray="6 6" opacity={0.6}>
                {!reduce && <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.2s" repeatCount="indefinite" />}
              </polyline>
              {TELEMETRY_NODES.map(([x, y], k) => (
                <circle key={k} cx={x} cy={y} r={4} fill="#fff" stroke="#4C6DE4" strokeWidth={2} />
              ))}
            </g>
          )}

          {i === 3 && (
            <g>
              {SPOKES.map(([x, y], k) => (
                <g key={k}>
                  <line x1={HUB[0]} y1={HUB[1]} x2={x} y2={y} stroke="#D6003C" strokeWidth={2} strokeDasharray="5 5" opacity={0.85}>
                    {!reduce && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1s" repeatCount="indefinite" />}
                  </line>
                  <circle cx={x} cy={y} r={3.5} fill="#D6003C" />
                </g>
              ))}
              {!reduce && (
                <circle cx={HUB[0]} cy={HUB[1]} r={6} fill="none" stroke="#D6003C" strokeWidth={2}>
                  <animate attributeName="r" values="6;22" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.7;0" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={HUB[0]} cy={HUB[1]} r={6} fill="#D6003C" />
            </g>
          )}
        </motion.g>
      ))}

      {/* Annotations appear once the stack has landed */}
      <motion.g
        variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
        transition={{ duration: 0.5, delay: reduce ? 0 : 0.9 }}
      >
        <Annotation anchor={RECOVERY} label="Smart Recovery" sub="agent proposes, engine checks" color="#D6003C" side="right" labelY={60} />
        <Annotation anchor={TELEMETRY_NODES[0]} label="Discovery" sub="maps · calls · whatsapp" color="#4C6DE4" side="left" labelY={TELEMETRY_NODES[0][1]} />
        <Annotation anchor={APPROVAL} label="Approvals" sub="you approve what runs" color="#179E56" side="right" labelY={470} />
      </motion.g>
    </motion.svg>
  );
}
