"use client";

import React from "react";

// Champ montant lisible : affiche les milliers groupes (ex. 1 500 000) tout en
// renvoyant au parent une chaine numerique brute ("1500000" ou "-5000").
// allowNegative autorise un signe moins en tete (utilise pour les corrections).

function groupDigits(raw: string, allowNegative: boolean): string {
  const negative = allowNegative && raw.trim().startsWith("-");
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return negative ? "-" : "";
  const grouped = new Intl.NumberFormat("fr-FR").format(Number(digits));
  return (negative ? "-" : "") + grouped;
}

type AmountInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string | number | null | undefined;
  onChange: (raw: string) => void;
  allowNegative?: boolean;
};

export default function AmountInput({ value, onChange, allowNegative = false, ...props }: AmountInputProps) {
  const display = groupDigits(String(value ?? ""), allowNegative);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value;
    const negative = allowNegative && input.trim().startsWith("-");
    const digits = input.replace(/[^\d]/g, "");
    onChange((negative ? "-" : "") + digits);
  };

  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={display}
      onChange={handleChange}
    />
  );
}
