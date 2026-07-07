"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProductVariant } from "@/lib/types";

// Logique de selection de variante partagee par la page produit, le modal et la
// carte catalogue. Objectifs UX :
//  - toutes les tailles ET couleurs sont visibles d'emblee (pas de sequence imposee) ;
//  - une combinaison inexistante est signalee comme desactivee, pas cachee ;
//  - quand il n'y a qu'une taille et/ou une couleur, elle est pre-selectionnee.
export function useVariantSelection(variants: ProductVariant[] | undefined) {
  const list = useMemo(() => variants || [], [variants]);

  const sizes = useMemo(
    () => Array.from(new Set(list.map((v) => v.size))),
    [list],
  );
  const colors = useMemo(
    () => Array.from(new Set(list.map((v) => v.color))),
    [list],
  );

  const [selectedSize, setSelectedSize] = useState("");
  const [selectedColor, setSelectedColor] = useState("");

  // Auto-selection : un seul choix possible = rien a decider pour le client.
  useEffect(() => {
    setSelectedSize(sizes.length === 1 ? sizes[0] : "");
    setSelectedColor(colors.length === 1 ? colors[0] : "");
  }, [sizes, colors]);

  const variantExists = useCallback(
    (size: string, color: string) => list.some((v) => v.size === size && v.color === color),
    [list],
  );

  // Une taille reste selectionnable si elle se marie avec la couleur deja choisie
  // (et inversement). Sans autre choix, on regarde juste son existence.
  const isSizeEnabled = useCallback(
    (size: string) => (selectedColor ? variantExists(size, selectedColor) : sizes.includes(size)),
    [selectedColor, sizes, variantExists],
  );
  const isColorEnabled = useCallback(
    (color: string) => (selectedSize ? variantExists(selectedSize, color) : colors.includes(color)),
    [selectedSize, colors, variantExists],
  );

  const selectSize = useCallback((size: string) => {
    setSelectedSize(size);
    // Si la couleur courante n'existe pas pour cette taille, on la reinitialise.
    setSelectedColor((current) => (current && variantExists(size, current) ? current : ""));
  }, [variantExists]);

  const selectColor = useCallback((color: string) => {
    setSelectedColor(color);
    setSelectedSize((current) => (current && variantExists(current, color) ? current : ""));
  }, [variantExists]);

  const currentVariant = useMemo(
    () => (selectedSize && selectedColor
      ? list.find((v) => v.size === selectedSize && v.color === selectedColor) || null
      : null),
    [list, selectedSize, selectedColor],
  );

  const isComplete = Boolean(currentVariant);

  return {
    sizes,
    colors,
    selectedSize,
    selectedColor,
    selectSize,
    selectColor,
    isSizeEnabled,
    isColorEnabled,
    currentVariant,
    isComplete,
    hasSingleSize: sizes.length === 1,
    hasSingleColor: colors.length === 1,
  };
}
