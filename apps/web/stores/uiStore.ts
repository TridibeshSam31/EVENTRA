"use client";

import { useEffect, useState } from "react";
import { getOperatorId, setOperatorId } from "../lib/api/client";

export interface OperatorIdentity {
  id: string;
  name: string;
  role: string;
  description: string;
}

export const OPERATOR_PROFILES: OperatorIdentity[] = [
  {
    // The real owner identity of the workspace's events, so organizer-only
    // actions (e.g. contacting real vendors) are attributed and authorized.
    id: "default-operator",
    name: "Elena Vance (Ops Director)",
    role: "MAIN_ORGANIZER",
    description: "Full command authority: approve actions, resolve incidents, declare go-live",
  },
  {
    id: "collab_alex",
    name: "Alex Rivera (Stage Lead)",
    role: "COLLABORATOR",
    description: "Field collaborator: requests changes, updates task status, logs incidents",
  },
  {
    id: "vendor_apex",
    name: "Apex Sound & Lights",
    role: "VENDOR",
    description: "External service provider: sends check-in telemetry, receives dispatches",
  },
  {
    id: "sys_observer",
    name: "Executive Viewer",
    role: "VIEWER",
    description: "Read-only access: telemetry inspection and decision trace auditing",
  },
];

export const OPERATOR_PERSONAS = OPERATOR_PROFILES;

export function useOperator() {
  const [operatorId, setOpId] = useState<string>("default-operator");

  useEffect(() => {
    setOpId(getOperatorId());
  }, []);

  const changeOperator = (newId: string) => {
    setOperatorId(newId);
    setOpId(newId);
  };

  const activeProfile =
    OPERATOR_PROFILES.find((p) => p.id === operatorId) || OPERATOR_PROFILES[0];

  return {
    operatorId,
    activeProfile,
    changeOperator,
    profiles: OPERATOR_PROFILES,
  };
}

export function useUiStore() {
  const op = useOperator();
  return {
    ...op,
    currentOperator: op.activeProfile,
    setOperator: (persona: OperatorIdentity) => op.changeOperator(persona.id),
  };
}
