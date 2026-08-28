"use client";

import React, { useState } from "react";
import Modal from "@/components/Modal";
import { PackingProductVariant, ProductWithVariants } from "../types";
import { getProductVariantsById, updateProductVariantStockLevels } from "@/modules/products/actions/actions";
import { getMediaFiles, uploadMediaFile } from "@/modules/media/actions";
import { processImageFile } from "@/lib/image-upload-helper";
import { AlertTriangle, Image as ImageIcon, MapPin, Minus, Plus, RefreshCw, Search, Upload, Warehouse, X } from "lucide-react";
import { getImageUrl } from "@/lib/utils";
import { clearStaleServerActionReloadFlag, reloadOnStaleServerAction } from "@/lib/stale-server-action";

type EditableStockLevel = {
  id?: string;
  warehouseId?: string;
  warehouseName: string;
  quantity: number;
  position?: string;
};

type EditableVariant = Omit<PackingProductVariant, "stockLevels"> & {
  stockLevels: EditableStockLevel[];
  image?: string | null;
};

type MediaFile = {
  name: string;
  url: string;
  size: number;
  createdAt: string | Date;
};

interface VariantsEditorModalProps {
  product: ProductWithVariants;
  variants?: PackingProductVariant[];
  onClose: () => void;
  onSave?: (variants: EditableVariant[]) => void;
}

export default function VariantsEditorModal({ product, variants: initialVariants, onClose, onSave }: VariantsEditorModalProps) {
  const hasInitialStockLevels = (initialVariants || []).some((variant) => Array.isArray(variant.stockLevels));

  const normalizeVariant = React.useCallback((variant: PackingProductVariant): EditableVariant => {
    const stockLevels = variant.stockLevels?.length
      ? variant.stockLevels.map((level) => ({
        id: level.id,
        warehouseId: level.warehouseId,
        warehouseName: level.warehouse?.name || "Entrepot",
        quantity: Math.max(0, Number(level.quantity) || 0),
        position: level.position || "",
      }))
      : [{
        warehouseId: undefined,
        warehouseName: "Magasin Principal",
        quantity: Math.max(0, Number(variant.stock) || 0),
        position: variant.location || "",
      }];

    return {
      ...variant,
      stock: stockLevels.reduce((sum, level) => sum + level.quantity, 0),
      location: stockLevels.find((level) => level.position)?.position || variant.location || "",
      stockLevels,
    };
  }, []);

  const [variants, setVariants] = useState<EditableVariant[]>(() => (initialVariants || []).map(normalizeVariant));
  const [lowStockThreshold, setLowStockThreshold] = useState(product.lowStockThreshold || 5);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [galleryVariantIndex, setGalleryVariantIndex] = useState<number | null>(null);
  const [gallerySearch, setGallerySearch] = useState("");
  const [uploadingVariantIndex, setUploadingVariantIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);

    getProductVariantsById(product.id)
      .then((fetchedVariants) => {
        if (!active) return;
        clearStaleServerActionReloadFlag();
        setVariants(fetchedVariants.map((variant: PackingProductVariant) => normalizeVariant(variant)));
      })
      .catch((error) => {
        if (reloadOnStaleServerAction(error)) return;
        if (!active) return;
        setError(hasInitialStockLevels ? null : "Impossible de charger les stocks en direct.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    getMediaFiles()
      .then((files) => {
        if (active) {
          clearStaleServerActionReloadFlag();
          setMediaFiles(files as MediaFile[]);
        }
      })
      .catch((error) => {
        reloadOnStaleServerAction(error);
      });

    return () => {
      active = false;
    };
  }, [hasInitialStockLevels, normalizeVariant, product.id]);

  const updateStockLevel = (
    variantIndex: number,
    stockLevelIndex: number,
    field: "quantity" | "position",
    value: string | number,
  ) => {
    setVariants((current) => current.map((variant, currentVariantIndex) => {
      if (currentVariantIndex !== variantIndex) return variant;

      const stockLevels = variant.stockLevels.map((level, currentLevelIndex) => {
        if (currentLevelIndex !== stockLevelIndex) return level;
        return {
          ...level,
          [field]: field === "quantity" ? Math.max(0, parseInt(String(value), 10) || 0) : String(value),
        };
      });

      return {
        ...variant,
        stockLevels,
        stock: stockLevels.reduce((sum, level) => sum + level.quantity, 0),
        location: stockLevels.find((level) => level.position)?.position || "",
      };
    }));
  };

  const updateVariantImage = (variantIndex: number, image: string) => {
    setVariants((current) => current.map((variant, currentVariantIndex) => (
      currentVariantIndex === variantIndex ? { ...variant, image } : variant
    )));
  };

  const handleVariantImageUpload = (variantIndex: number, file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Seules les images sont autorisees.");
      return;
    }

    const reader = new FileReader();
    setUploadingVariantIndex(variantIndex);
    setError(null);

    reader.onload = async () => {
      try {
        const { dataUrl, fileName } = await processImageFile(file);
        const result = await uploadMediaFile(dataUrl, fileName);

        if (!result.success || !result.url) {
          setError(result.error || "Erreur lors de l'upload de l'image.");
          return;
        }

        const uploaded: MediaFile = {
          name: result.url.split("/").pop() || file.name,
          url: result.url,
          size: file.size,
          createdAt: new Date(),
        };

        setMediaFiles((current) => [uploaded, ...current]);
        updateVariantImage(variantIndex, result.url);
      } catch (error) {
        if (reloadOnStaleServerAction(error)) return;
        setError("Erreur lors de l'upload de l'image.");
      } finally {
        setUploadingVariantIndex(null);
      }
    };

    reader.onerror = () => {
      setUploadingVariantIndex(null);
      setError("Erreur lors de la lecture de l'image.");
    };

    reader.readAsDataURL(file);
  };

  const filteredMediaFiles = React.useMemo(() => (
    mediaFiles.filter((file) => file.name.toLowerCase().includes(gallerySearch.toLowerCase()))
  ), [gallerySearch, mediaFiles]);

  const totalQty = variants.reduce(
    (sum, variant) => sum + variant.stockLevels.reduce((levelSum, level) => levelSum + level.quantity, 0),
    0,
  );

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await updateProductVariantStockLevels(product.id, {
        lowStockThreshold,
        variants: variants.map((variant) => ({
          id: variant.id,
          size: variant.size,
          color: variant.color,
          image: variant.image || null,
          stock: variant.stock,
          location: variant.location || undefined,
          stockLevels: variant.stockLevels.map((level) => ({
            id: level.id,
            warehouseId: level.warehouseId,
            warehouseName: level.warehouseName,
            quantity: level.quantity,
            position: level.position || undefined,
          })),
        })),
      });

      if (onSave) onSave(variants);
      else onClose();
    } catch (error) {
      if (reloadOnStaleServerAction(error)) return;
      setError("Erreur lors de l'enregistrement des stocks.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RefreshCw size={18} className="text-orange" />
          <span>Gestion du Stock</span>
        </div>
      }
      large
      footer={
        <div style={{ display: "flex", gap: 12, width: "100%" }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={isLoading || isSaving}>
            Annuler
          </button>
          <button
            className="btn-orange"
            onClick={handleSave}
            disabled={isLoading || isSaving}
            style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}
          >
            {isSaving && <span className="animate-spin" style={{ display: "inline-block", width: 14, height: 14, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%" }} />}
            <span className="stock-save-label-full">{isSaving ? "Sauvegarde..." : "Enregistrer les modifications"}</span>
            <span className="stock-save-label-short">{isSaving ? "..." : "Enregistrer"}</span>
          </button>
        </div>
      }
    >
      <div className="variants-editor-header">
        <div className="editor-product-info">
          {product.images?.[0] ? (
            <img src={getImageUrl(product.images[0].url)} className="editor-thumb" alt={product.name} />
          ) : (
            <div className="editor-thumb-placeholder">PKG</div>
          )}
          <div>
            <h3>{product.name}</h3>
            <p>
              Stock total : <span className={totalQty === 0 ? "text-red" : "text-green"}>{totalQty} unités</span>
            </p>
          </div>
        </div>
        <div className="threshold-config">
          <label>Seuil d&apos;alerte</label>
          <div className="threshold-input-wrapper">
            <input
              type="number"
              min={0}
              value={lowStockThreshold}
              onChange={(event) => setLowStockThreshold(Math.max(0, parseInt(event.target.value, 10) || 0))}
            />
            <AlertTriangle size={14} className="threshold-icon" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--brown-soft)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span className="animate-spin" style={{ display: "inline-block", width: 16, height: 16, border: "2px solid var(--orange)", borderTopColor: "transparent", borderRadius: "50%" }} />
          Chargement des stocks en direct...
        </div>
      ) : error ? (
        <div style={{ padding: "18px 20px", background: "#FEE2E2", color: "#B91C1C", borderRadius: 12, fontWeight: 700, fontSize: 13 }}>
          {error}
        </div>
      ) : (
        <div className="variants-editor-grid">
          {variants.map((variant, variantIndex) => (
            <div key={variant.id || `${variant.size}-${variant.color}-${variantIndex}`} className="variant-edit-card">
              <div className="v-card-header">
                <div style={{ width: 42, height: 48, borderRadius: 8, overflow: "hidden", background: "var(--cream-2)", border: "1px solid var(--border)", flexShrink: 0 }}>
                  {variant.image ? (
                    <img src={getImageUrl(variant.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : product.images?.[0] ? (
                    <img src={getImageUrl(product.images[0].url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.45 }} />
                  ) : (
                    <span style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 900, color: "var(--muted)" }}>IMG</span>
                  )}
                </div>
                <span className="v-card-tag">{variant.size}</span>
                <span className="v-card-color-name">{variant.color}</span>
                <span className="variant-total-pill">
                  {variant.stockLevels.reduce((sum, level) => sum + level.quantity, 0)} u.
                </span>
              </div>

              <div className="v-card-controls">
                <div className="stock-level-editor" data-first="true">
                  <div className="stock-level-warehouse">
                    <ImageIcon size={14} className="text-orange" />
                    <span>Image de la variante</span>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      type="text"
                      value={variant.image || ""}
                      onChange={(event) => updateVariantImage(variantIndex, event.target.value)}
                      placeholder="URL image ou selection galerie"
                      className="field-input"
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <label className="btn-secondary" style={{ cursor: uploadingVariantIndex === variantIndex ? "not-allowed" : "pointer" }}>
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploadingVariantIndex === variantIndex}
                          style={{ display: "none" }}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) handleVariantImageUpload(variantIndex, file);
                            event.target.value = "";
                          }}
                        />
                        <Upload size={14} /> {uploadingVariantIndex === variantIndex ? "Upload..." : "Uploader"}
                      </label>
                      <button type="button" className="btn-secondary" onClick={() => setGalleryVariantIndex(variantIndex)}>
                        <ImageIcon size={14} /> Galerie
                      </button>
                      {variant.image && (
                        <button type="button" className="btn-secondary" onClick={() => updateVariantImage(variantIndex, "")}>
                          <X size={14} /> Retirer
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {variant.stockLevels.map((level, stockLevelIndex) => (
                  <div
                    key={level.id || `${level.warehouseName}-${stockLevelIndex}`}
                    className="stock-level-editor"
                    data-first={stockLevelIndex === 0 ? "true" : "false"}
                  >
                    <div className="stock-level-warehouse">
                      <Warehouse size={14} className="text-orange" />
                      <span>{level.warehouseName}</span>
                    </div>

                    <div className="control-group">
                      <label>Quantité en stock</label>
                      <div className="qty-stepper">
                        <button onClick={() => updateStockLevel(variantIndex, stockLevelIndex, "quantity", level.quantity - 1)}><Minus size={14} /></button>
                        <input
                          type="number"
                          min={0}
                          value={level.quantity}
                          onChange={(event) => updateStockLevel(variantIndex, stockLevelIndex, "quantity", event.target.value)}
                        />
                        <button onClick={() => updateStockLevel(variantIndex, stockLevelIndex, "quantity", level.quantity + 1)}><Plus size={14} /></button>
                      </div>
                    </div>

                    <div className="control-group">
                      <label>Emplacement (Rayon/Casier)</label>
                      <div className="location-input-wrapper">
                        <MapPin size={14} className="loc-icon" />
                        <input
                          type="text"
                          value={level.position || ""}
                          onChange={(event) => updateStockLevel(variantIndex, stockLevelIndex, "position", event.target.value)}
                          placeholder="Ex: A1-02"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {galleryVariantIndex !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(26,20,16,0.52)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(900px, 100%)", maxHeight: "84vh", background: "#fff", borderRadius: 12, overflow: "hidden", display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }}>
            <div style={{ padding: 18, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div className="table-title">Choisir une image de variante</div>
                <div className="table-meta">{filteredMediaFiles.length} image(s)</div>
              </div>
              <button className="btn-secondary" onClick={() => setGalleryVariantIndex(null)}>
                <X size={14} /> Fermer
              </button>
            </div>
            <div style={{ margin: 14, height: 42, border: "1px solid var(--border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", color: "var(--muted)" }}>
              <Search size={16} />
              <input
                value={gallerySearch}
                onChange={(event) => setGallerySearch(event.target.value)}
                placeholder="Rechercher dans la galerie..."
                style={{ flex: 1, border: "none", outline: "none", color: "var(--ink)", fontSize: 13 }}
              />
            </div>
            <div style={{ padding: "0 14px 14px", overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
              {filteredMediaFiles.map((file) => (
                <button
                  key={file.url}
                  type="button"
                  onClick={() => {
                    updateVariantImage(galleryVariantIndex, file.url);
                    setGalleryVariantIndex(null);
                  }}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, background: "#fff", overflow: "hidden", padding: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <img src={file.url} alt={file.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                  <span style={{ display: "block", padding: 8, fontSize: 10, fontWeight: 800, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                </button>
              ))}
              {filteredMediaFiles.length === 0 && (
                <div style={{ gridColumn: "1 / -1", padding: 28, textAlign: "center", color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 8 }}>
                  Aucune image trouvee.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
