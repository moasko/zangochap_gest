"use client";

import React, { useState, useRef } from "react";
import { X, RefreshCcw, Save, Sparkles, Warehouse, Check, ChevronsUpDown, Plus, Image as ImageIcon, Upload, Link as LinkIcon, Clipboard } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn, getImageUrl } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { processImageFile } from "@/lib/image-upload-helper";

/**
 * Compresse et redimensionne une image côté client
 */
const compressImage = async (file: File): Promise<string> => {
  const { dataUrl } = await processImageFile(file);
  return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        const MAX_SIZE = 1200;
        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        }

        resolve(canvas.toDataURL('image/webp', 0.7));
      };
      img.src = dataUrl;
  });
};

function SupplierCombobox({ suppliers, value, onChange }: { suppliers: any[], value: string, onChange: (val: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="w-full bg-white border-[1.5px] border-[#E8DDD0] rounded-[10px] py-[10px] px-[14px] font-semibold text-[14px] text-left flex justify-between items-center h-[45px] transition-all focus:ring-4 focus:ring-[#F4E4D7] outline-none"
      >
        <span className="truncate">{value || "Sélectionner un fournisseur..."}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className=" w-full p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Rechercher..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className="p-0">
              <button
                type="button"
                className="w-full text-left p-3 hover:bg-orange-50 rounded-none text-sm font-semibold text-[#D4541C] flex items-center gap-2 border-t border-[#eee]"
                onClick={() => {
                  onChange(search);
                  setOpen(false);
                }}
              >
                <Plus size={14} /> Creer {search}
              </button>
            </CommandEmpty>
            <CommandGroup>
              {suppliers.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.name}
                  onSelect={(currentValue) => {
                    onChange(currentValue);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 p-2"
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === s.name ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface ProductFormProps {
  initialData?: any;
  defaultIsGift?: boolean;
  categories: any[];
  suppliers: any[];
  warehouses: any[];
  commercials?: any[];
  user?: any;
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
  isPending: boolean;
  title: string;
}

type ProductFormVariant = {
  id?: string;
  size: string;
  color: string;
  image?: string;
  stock: number;
  location: string;
};

type ProductFormStockLevel = {
  warehouseId?: string;
  position?: string | null;
};

type ProductFormInitialVariant = ProductFormVariant & {
  stockLevels?: ProductFormStockLevel[];
};

const splitVariantValues = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export default function ProductForm({
  initialData,
  defaultIsGift = false,
  categories,
  suppliers,
  warehouses,
  commercials = [],
  user,
  onSubmit,
  onCancel,
  isPending,
  title
}: ProductFormProps) {
  const { showToast } = useToast();
  const imgInputRef = useRef<HTMLInputElement>(null);
  const sourceVariants: ProductFormInitialVariant[] = initialData?.variants || [];
  const initialVariants: ProductFormVariant[] = sourceVariants.map((v) => ({
    id: v.id,
    size: v.size || '',
    color: v.color || '',
    image: v.image || '',
    stock: Math.max(0, Number(v.stock) || 0),
    location: v.location || v.stockLevels?.find((level) => level.position)?.position || ''
  }));
  const initialWarehouseId =
    sourceVariants.flatMap((variant) => variant.stockLevels || []).find((level) => level.warehouseId)?.warehouseId
    || warehouses[0]?.id
    || '';

  // -- States --
  const [images, setImages] = useState<Array<{ name: string; dataUrl: string }>>(
    initialData?.images?.map((img: any) => ({ name: img.name, dataUrl: img.url })) || []
  );
  const [name, setName] = useState(initialData?.name || '');
  const [category, setCategory] = useState(initialData?.category?.name || categories[0]?.name || '');
  const [subCategory, setSubCategory] = useState(initialData?.subCategory?.name || '');
  const [price, setPrice] = useState<number>(initialData?.price ? Number(initialData.price) : 0);
  const [oldPrice, setOldPrice] = useState<number | null>(initialData?.oldPrice ? Number(initialData.oldPrice) : null);
  const [material, setMaterial] = useState(initialData?.material || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [origin, setOrigin] = useState(initialData?.origin || '');
  const [supplier, setSupplier] = useState(initialData?.supplier?.name || '');
  const [selectedWarehouse, setSelectedWarehouse] = useState(initialWarehouseId);
  const isAdmin = ['admin', 'developer'].includes(String(user?.role || '').toLowerCase());
  const [selectedCreatorId, setSelectedCreatorId] = useState(initialData?.creatorId || user?.id || '');

  const [sizes, setSizes] = useState<string[]>(Array.from(new Set(initialVariants.map(v => v.size).filter(Boolean))));
  const [colors, setColors] = useState<string[]>(Array.from(new Set(initialVariants.map(v => v.color).filter(Boolean))));
  const [sizeInput, setSizeInput] = useState('');
  const [colorInput, setColorInput] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [isDraggingImages, setIsDraggingImages] = useState(false);

  const [variants, setVariants] = useState<ProductFormVariant[]>(initialVariants);
  const [isUnpublished, setIsUnpublished] = useState(initialData ? initialData.status !== 'PUBLISHED' : false);
  const [isFeatured, setIsFeatured] = useState(initialData?.isFeatured ?? false);
  const [isGift, setIsGift] = useState(initialData?.isGift ?? defaultIsGift);

  // -- Handlers --
  const addImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name));
    if (!imageFiles.length) {
      showToast("Aucune image valide trouvee", "error");
      return;
    }

    await Promise.all(imageFiles.map(async (file) => {
      try {
        const optimizedDataUrl = await compressImage(file);
        setImages(prev => [...prev, { name: file.name, dataUrl: optimizedDataUrl }]);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Erreur d'optimisation image", "error");
      }
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addImageFiles(Array.from(e.target.files || []));
    e.target.value = '';
  };

  const addImageUrl = () => {
    const url = imageUrlInput.trim();
    if (!url) return;
    if (!/^https?:\/\/.+/i.test(url) && !url.startsWith('/')) {
      showToast("URL d'image invalide", "error");
      return;
    }
    const name = url.split('/').pop()?.split('?')[0] || `image-${images.length + 1}`;
    setImages(prev => [...prev, { name, dataUrl: url }]);
    setImageUrlInput('');
    showToast("Image ajoutee depuis l'URL", "success");
  };

  const handleImagePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files || []);
    if (files.length) {
      addImageFiles(files);
      return;
    }
    const text = event.clipboardData.getData('text').trim();
    if (/^(https?:\/\/|\/).+\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(text)) {
      setImages(prev => [...prev, { name: text.split('/').pop()?.split('?')[0] || `image-${prev.length + 1}`, dataUrl: text }]);
      showToast("Image collee depuis l'URL", "success");
    }
  };

  const removeImage = (idx: number) => {
    setImages(images.filter((_, i) => i !== idx));
  };

  const setMainImage = (idx: number) => {
    const newImgs = [...images];
    const [img] = newImgs.splice(idx, 1);
    newImgs.unshift(img);
    setImages(newImgs);
  };

  const addSize = () => {
    const vals = splitVariantValues(sizeInput);
    if (!vals.length) return;
    const newSizes = [...sizes];
    vals.forEach(val => { if (!newSizes.includes(val)) newSizes.push(val); });
    setSizes(newSizes);
    setSizeInput('');
  };

  const addColor = () => {
    const vals = splitVariantValues(colorInput);
    if (!vals.length) return;
    const newColors = [...colors];
    vals.forEach(val => { if (!newColors.includes(val)) newColors.push(val); });
    setColors(newColors);
    setColorInput('');
  };

  const addManualVariants = () => {
    const nextSizes = splitVariantValues(sizeInput);
    const nextColors = splitVariantValues(colorInput);

    if (!nextSizes.length || !nextColors.length) {
      showToast('Renseigne une taille et une couleur', 'error');
      return;
    }

    const existing = new Set(variants.map(v => `${v.size.trim().toLowerCase()}|${v.color.trim().toLowerCase()}`));
    const added: ProductFormVariant[] = [];

    nextSizes.forEach(size => {
      nextColors.forEach(color => {
        const key = `${size.toLowerCase()}|${color.toLowerCase()}`;
        if (!existing.has(key)) {
          existing.add(key);
          added.push({ size, color, image: '', stock: 0, location: '' });
        }
      });
    });

    if (!added.length) {
      showToast('Cette variante existe deja', 'error');
      return;
    }

    setVariants(prev => [...prev, ...added]);
    setSizes(prev => Array.from(new Set([...prev, ...nextSizes])));
    setColors(prev => Array.from(new Set([...prev, ...nextColors])));
    setSizeInput('');
    setColorInput('');
    showToast(`${added.length} variante(s) ajoutee(s)`, 'success');
  };

  const generateAllVariants = () => {
    if (!sizes.length || !colors.length) {
      showToast('Ajoute au moins 1 taille et 1 couleur', 'error');
      return;
    }
    const existing = new Set(variants.map(v => `${v.size.trim().toLowerCase()}|${v.color.trim().toLowerCase()}`));
    const newVariants = [...variants];
    let addedCount = 0;
    sizes.forEach(s => {
      colors.forEach(c => {
        const key = `${s.trim().toLowerCase()}|${c.trim().toLowerCase()}`;
        if (!existing.has(key)) {
          existing.add(key);
          newVariants.push({ size: s, color: c, image: '', stock: 0, location: '' });
          addedCount++;
        }
      });
    });
    if (addedCount === 0) {
      showToast('Toutes ces variantes existent deja', 'error');
      return;
    }
    setVariants(newVariants);
    showToast(`${addedCount} variante(s) générée(s)`, 'success');
  };

  const updateVariant = (idx: number, field: string, value: any) => {
    const newVariants = [...variants];
    newVariants[idx] = {
      ...newVariants[idx],
      [field]: field === 'stock' ? Math.max(0, parseInt(value) || 0) : value
    };
    setVariants(newVariants);
  };

  const handleVariantImageUpload = async (idx: number, file: File) => {
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
      showToast("Seules les images sont autorisees", "error");
      return;
    }

    try {
      const optimizedDataUrl = await compressImage(file);
      updateVariant(idx, 'image', optimizedDataUrl);
    } catch {
      showToast("Erreur lors de l'image variante", "error");
    }
  };

  const removeVariant = (idx: number) => {
    setVariants(variants.filter((_, i) => i !== idx));
  };

  const handleFormSubmit = () => {
    if (!name || (price <= 0 && !isGift)) {
      showToast("Nom et prix requis", "error");
      return;
    }

    let finalVariants = variants.map(v => ({
      ...v,
      size: v.size.trim(),
      color: v.color.trim(),
      stock: Math.max(0, Number(v.stock) || 0),
      location: v.location.trim()
    }));
    const pendingSizes = splitVariantValues(sizeInput);
    const pendingColors = splitVariantValues(colorInput);
    if (pendingSizes.length && pendingColors.length) {
      const existing = new Set(finalVariants.map(v => `${v.size.toLowerCase()}|${v.color.toLowerCase()}`));
      pendingSizes.forEach(size => {
        pendingColors.forEach(color => {
          const key = `${size.toLowerCase()}|${color.toLowerCase()}`;
          if (!existing.has(key)) {
            existing.add(key);
            finalVariants.push({ size, color, image: '', stock: 0, location: '' });
          }
        });
      });
    }
    if (finalVariants.length === 0 && !initialData) {
      finalVariants = [{ size: 'Standard', color: 'Standard', image: '', stock: 0, location: '' }];
    }
    if (finalVariants.some(v => !v.size || !v.color)) {
      showToast("Chaque variante doit avoir une taille et une couleur", "error");
      return;
    }
    const duplicateVariant = finalVariants.find((variant, index) => {
      const key = `${variant.size.toLowerCase()}|${variant.color.toLowerCase()}`;
      return finalVariants.findIndex(item => `${item.size.toLowerCase()}|${item.color.toLowerCase()}` === key) !== index;
    });
    if (duplicateVariant) {
      showToast(`Variante en double : ${duplicateVariant.size} / ${duplicateVariant.color}`, "error");
      return;
    }

    onSubmit({
      name,
      category,
      subCategory,
      price,
      oldPrice,
      description,
      material,
      origin,
      location: finalVariants.find(v => v.location)?.location || '',
      supplier: supplier || 'Non spécifié',
      isPublished: !isUnpublished,
      isFeatured,
      isGift,
      variants: finalVariants,
      images: initialData || images.length > 0 ? images : undefined,
      emoji: initialData?.emoji || "📦",
      warehouseId: selectedWarehouse,
      creatorId: isAdmin ? selectedCreatorId : undefined
    });
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#FDFCFB]">
      {/* HEADER FIXE */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#E8DDD0] px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#D4541C] mb-1">Catalogue</div>
          <h1 className="text-xl font-bold text-[#1A1410] tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="px-4 py-2 text-[13px] font-semibold text-[#6B4838] hover:bg-[#FAF6F1] rounded-lg transition-colors"
            onClick={onCancel}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn-orange shadow-lg shadow-orange-500/20 px-6 py-2.5 rounded-lg flex items-center gap-2"
            onClick={handleFormSubmit}
            disabled={isPending}
          >
            {isPending ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
            <span>Enregistrer</span>
          </button>
        </div>
      </div>

      <div className="flex-1 max-w-[1200px] mx-auto w-full px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* COLONNE PRINCIPALE (2/3) */}
          <div className="lg:col-span-2 space-y-6">

            {/* CARD: GÉNÉRAL */}
            <div className="bg-white border border-[#E8DDD0] rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-[#F8F5F2] bg-[#FDFCFB]">
                <h2 className="font-bold text-[#1A1410]">Général</h2>
              </div>
              <div className="p-6 space-y-5">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Titre du produit</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Ex: Sneakers cuir Blanc"
                    className="w-full bg-white border border-[#E8DDD0] rounded-lg p-3 text-sm font-semibold focus:ring-2 focus:ring-[#D4541C]/10 focus:border-[#D4541C] outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Description</label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Décrivez les caractéristiques du produit..."
                    className="w-full bg-white border border-[#E8DDD0] rounded-lg p-3 text-sm font-medium min-h-[120px] focus:ring-2 focus:ring-[#D4541C]/10 focus:border-[#D4541C] outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            {/* CARD: MÉDIAS */}
            <div className="bg-white border border-[#E8DDD0] rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-[#F8F5F2] bg-[#FDFCFB] flex items-center justify-between">
                <h2 className="font-bold text-[#1A1410]">Médias</h2>
                <button
                  type="button"
                  onClick={() => imgInputRef.current?.click()}
                  className="text-[12px] font-bold text-[#D4541C] hover:underline flex items-center gap-1"
                >
                  <Plus size={14} /> Ajouter
                </button>
              </div>
              <div className="p-6" onPaste={handleImagePaste}>
                <div
                  onClick={() => imgInputRef.current?.click()}
                  onDragOver={(event) => { event.preventDefault(); setIsDraggingImages(true); }}
                  onDragLeave={() => setIsDraggingImages(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDraggingImages(false);
                    addImageFiles(Array.from(event.dataTransfer.files || []));
                  }}
                  className={cn(
                    "group border-2 border-dashed bg-[#FAF6F1]/50 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all",
                    isDraggingImages ? "border-[#D4541C] ring-4 ring-[#D4541C]/10 bg-[#D4541C]/5" : "border-[#E8DDD0] hover:border-[#D4541C]"
                  )}
                >
                  <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center text-[#D4541C] group-hover:scale-110 transition-transform">
                    <Upload size={24} />
                  </div>
                  <p className="mt-4 text-sm font-bold text-[#1A1410]">Ajouter des images</p>
                  <p className="text-xs text-[#6B4838] mt-1">PNG, JPG, WebP, HEIC, 10MB max</p>
                </div>
                <input type="file" ref={imgInputRef} multiple accept="image/*,.heic,.heif" className="hidden" onChange={handleImageUpload} />

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                  <div className="relative">
                    <LinkIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A7A6D]" />
                    <input
                      type="url"
                      value={imageUrlInput}
                      onChange={e => setImageUrlInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addImageUrl())}
                      placeholder="Coller une URL d'image"
                      className="w-full bg-white border border-[#E8DDD0] rounded-lg py-2.5 pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#D4541C]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addImageUrl}
                    className="px-4 py-2.5 bg-[#1A1410] text-white rounded-lg text-[12px] font-bold flex items-center justify-center gap-2 hover:bg-[#D4541C] transition-colors"
                  >
                    <Plus size={14} /> URL
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-[#6B4838]">
                  <Clipboard size={14} />
                  <span>Tu peux aussi coller directement une capture ou une image copiee.</span>
                </div>

                {images.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4 mt-6">
                    {images.map((img, idx) => (
                      <div key={idx} className={cn(
                        "group relative aspect-square rounded-lg border-2 overflow-hidden transition-all",
                        idx === 0 ? "border-[#D4541C] shadow-md ring-2 ring-[#D4541C]/10" : "border-[#E8DDD0] hover:border-[#D4541C]/50"
                      )}>
                        <img src={getImageUrl(img.dataUrl)} className="w-full h-full object-cover" alt="" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          {idx !== 0 && (
                            <button type="button" onClick={() => setMainImage(idx)} className="p-1.5 bg-white rounded-md text-[#D4541C] hover:scale-110 transition-transform">
                              <Sparkles size={14} />
                            </button>
                          )}
                          <button type="button" onClick={() => removeImage(idx)} className="p-1.5 bg-red-500 rounded-md text-white hover:scale-110 transition-transform">
                            <X size={14} />
                          </button>
                        </div>
                        {idx === 0 && (
                          <div className="absolute bottom-2 left-2 right-2 bg-white/90 text-[#D4541C] text-[8px] font-black uppercase tracking-tighter text-center py-0.5 rounded shadow-sm">
                            Principale
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* CARD: PRIX */}
            <div className="bg-white border border-[#E8DDD0] rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-[#F8F5F2] bg-[#FDFCFB]">
                <h2 className="font-bold text-[#1A1410]">Prix</h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Prix de vente</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={isGift ? 0 : (price || '')}
                        onChange={e => setPrice(parseInt(e.target.value) || 0)}
                        placeholder="0"
                        disabled={isGift}
                        className={cn(
                          "w-full bg-white border border-[#E8DDD0] rounded-lg p-3 pr-12 text-sm font-bold focus:ring-2 focus:ring-[#D4541C]/10 focus:border-[#D4541C] outline-none transition-all",
                          isGift && "bg-[#FDFCFB] opacity-60 cursor-not-allowed"
                        )}
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-[#6B4838]">FCFA</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Prix comparatif</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={oldPrice || ''}
                        onChange={e => setOldPrice(parseInt(e.target.value) || null)}
                        placeholder="0"
                        className="w-full bg-[#FDFCFB] border border-[#E8DDD0] rounded-lg p-3 pr-12 text-sm font-semibold text-[#6B4838] focus:ring-2 focus:ring-[#D4541C]/10 focus:border-[#D4541C] outline-none transition-all"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-[#6B4838]">FCFA</span>
                    </div>
                    <p className="text-[10px] text-[#6B4838]/60 italic">Pour afficher un badge Promo</p>
                  </div>
                </div>
              </div>
            </div>

            {/* CARD: INVENTAIRE & VARIANTES */}
            <div className="bg-white border border-[#E8DDD0] rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-[#F8F5F2] bg-[#FDFCFB] flex items-center justify-between">
                <h2 className="font-bold text-[#1A1410]">Variantes & Stock</h2>
                <button
                  type="button"
                  className="px-3 py-1.5 bg-[#D4541C]/10 text-[#D4541C] text-[11px] font-bold rounded-lg hover:bg-[#D4541C]/20 transition-colors flex items-center gap-1.5"
                  onClick={generateAllVariants}
                >
                  <RefreshCcw size={12} /> Générer
                </button>
              </div>
              <div className="p-4 sm:p-6 space-y-6">
                {/* Configuration des attributs */}
                <div className="rounded-xl border border-[#E8DDD0] bg-[#FDFCFB] p-4 sm:p-5 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h3 className="text-[14px] font-black text-[#1A1410]">Créer les variantes</h3>
                      <p className="text-[11px] font-semibold text-[#6B4838] mt-1">Saisis plusieurs valeurs avec des virgules, puis ajoute ou génère.</p>
                    </div>
                    <div className="rounded-lg bg-white border border-[#E8DDD0] px-3 py-2 text-[12px] font-black text-[#D4541C]">
                      {variants.length} variante(s)
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white border border-[#E8DDD0] rounded-xl p-3 space-y-3">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Tailles</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={sizeInput}
                          onChange={e => setSizeInput(e.target.value)}
                          placeholder="Ex: 39, 40, 41"
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSize())}
                          className="flex-1 bg-white border border-[#E8DDD0] rounded-lg p-2.5 text-sm font-semibold outline-none focus:border-[#D4541C]"
                        />
                        <button type="button" onClick={addSize} className="w-10 h-10 bg-[#1A1410] text-white rounded-lg flex items-center justify-center hover:bg-[#D4541C] transition-colors"><Plus size={18} /></button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {sizes.map(s => (
                          <span key={s} className="px-2 py-1 bg-[#1A1410] text-white text-[10px] font-bold rounded-md flex items-center gap-2">
                            {s} <X size={10} className="cursor-pointer hover:text-red-400" onClick={() => setSizes(sizes.filter(x => x !== s))} />
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E8DDD0] rounded-xl p-3 space-y-3">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Couleurs</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={colorInput}
                          onChange={e => setColorInput(e.target.value)}
                          placeholder="Ex: Noir, Blanc"
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addColor())}
                          className="flex-1 bg-white border border-[#E8DDD0] rounded-lg p-2.5 text-sm font-semibold outline-none focus:border-[#D4541C]"
                        />
                        <button type="button" onClick={addColor} className="w-10 h-10 bg-[#1A1410] text-white rounded-lg flex items-center justify-center hover:bg-[#D4541C] transition-colors"><Plus size={18} /></button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {colors.map(c => (
                          <span key={c} className="px-3 py-1 border border-[#E8DDD0] bg-[#FDFCFB] text-[#1A1410] text-[10px] font-bold rounded-full flex items-center gap-2">
                            {c} <X size={10} className="cursor-pointer hover:text-red-400" onClick={() => setColors(colors.filter(x => x !== c))} />
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={addManualVariants}
                      className="w-full px-4 py-2.5 bg-[#1A1410] text-white rounded-lg text-[12px] font-bold flex items-center justify-center gap-2 hover:bg-[#D4541C] transition-colors"
                    >
                      <Plus size={14} /> Ajouter
                    </button>
                    <button
                      type="button"
                      onClick={generateAllVariants}
                      className="w-full px-4 py-2.5 bg-[#D4541C]/10 text-[#D4541C] rounded-lg text-[12px] font-bold flex items-center justify-center gap-2 hover:bg-[#D4541C]/20 transition-colors"
                    >
                      <RefreshCcw size={14} /> Générer tout
                    </button>
                  </div>
                </div>

                {/* Cartes des variantes */}
                {variants.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <h3 className="text-[14px] font-black text-[#1A1410]">Liste des variantes</h3>
                        <p className="text-[11px] font-semibold text-[#6B4838]">Chaque variante garde son stock, son image et son emplacement.</p>
                      </div>
                      <div className="rounded-lg bg-[#D4541C]/10 text-[#D4541C] px-3 py-2 text-[13px] font-black">
                        Total: {variants.reduce((s, v) => s + v.stock, 0)}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {variants.map((v, idx) => (
                        <div key={`${v.id || 'new'}-${idx}`} className="rounded-xl border border-[#E8DDD0] bg-white p-3 sm:p-4 shadow-sm">
                          <div className="flex items-start gap-3">
                            <div className="w-16 h-20 rounded-lg overflow-hidden bg-[#FAF6F1] border border-[#E8DDD0] flex items-center justify-center shrink-0">
                              {v.image ? (
                                <img src={getImageUrl(v.image)} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <ImageIcon size={20} className="text-[#C8B8AA]" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-black uppercase tracking-wider text-[#8A7A6D]">Variante #{idx + 1}</p>
                                  <p className="truncate text-[14px] font-black text-[#1A1410]">{v.size || 'Taille'} / {v.color || 'Couleur'}</p>
                                </div>
                                <button type="button" onClick={() => removeVariant(idx)} className="w-8 h-8 rounded-lg bg-red-50 text-[#C73E1D] flex items-center justify-center hover:bg-red-100 transition-colors" title="Retirer">
                                  <X size={16} />
                                </button>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <label className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-[#FDFCFB] text-[11px] font-black text-[#D4541C] cursor-pointer inline-flex items-center gap-1.5 hover:border-[#D4541C] transition-colors">
                                  <input
                                    type="file"
                                    accept="image/*,.heic,.heif"
                                    className="hidden"
                                    onChange={(event) => {
                                      const file = event.target.files?.[0];
                                      if (file) handleVariantImageUpload(idx, file);
                                      event.target.value = "";
                                    }}
                                  />
                                  <Upload size={13} /> Image
                                </label>
                                {v.image && (
                                  <button
                                    type="button"
                                    onClick={() => updateVariant(idx, 'image', '')}
                                    className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-[11px] font-bold text-[#8A7A6D] hover:text-[#C73E1D] hover:border-[#C73E1D]/30"
                                  >
                                    Retirer image
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black uppercase tracking-wider text-[#6B4838]">Taille</label>
                              <input
                                type="text"
                                value={v.size}
                                onChange={e => updateVariant(idx, 'size', e.target.value)}
                                placeholder="Taille"
                                className="w-full bg-white border border-[#E8DDD0] rounded-lg p-2.5 text-sm font-bold outline-none focus:border-[#D4541C]"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black uppercase tracking-wider text-[#6B4838]">Couleur</label>
                              <input
                                type="text"
                                value={v.color}
                                onChange={e => updateVariant(idx, 'color', e.target.value)}
                                placeholder="Couleur"
                                className="w-full bg-white border border-[#E8DDD0] rounded-lg p-2.5 text-sm font-semibold outline-none focus:border-[#D4541C]"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black uppercase tracking-wider text-[#6B4838]">Stock</label>
                              <input
                                type="number"
                                value={v.stock}
                                onChange={e => updateVariant(idx, 'stock', e.target.value)}
                                className="w-full bg-white border border-[#E8DDD0] rounded-lg p-2.5 text-sm text-center font-black outline-none focus:border-[#D4541C]"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black uppercase tracking-wider text-[#6B4838]">Emplacement</label>
                              <input
                                type="text"
                                value={v.location}
                                onChange={e => updateVariant(idx, 'location', e.target.value)}
                                placeholder="A1-24"
                                className="w-full bg-[#FAF6F1]/40 border border-[#E8DDD0] rounded-lg p-2.5 text-sm font-mono font-bold outline-none focus:border-[#D4541C] focus:bg-white transition-all"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {false && variants.length > 0 && (
                  <div className="border border-[#E8DDD0] rounded-xl overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm border-collapse">
                      <thead className="bg-[#FAF6F1] border-b border-[#E8DDD0]">
                        <tr>
                          <th className="px-4 py-3 text-[10px] font-black uppercase text-[#6B4838] tracking-widest w-32">Image</th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase text-[#6B4838] tracking-widest">Variante</th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase text-[#6B4838] tracking-widest text-center w-24">Stock</th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase text-[#6B4838] tracking-widest">Emplacement</th>
                          <th className="px-4 py-3 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F8F5F2]">
                        {variants.map((v, idx) => (
                          <tr key={idx} className="hover:bg-[#FDFCFB] transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-12 h-14 rounded-md overflow-hidden bg-[#FAF6F1] border border-[#E8DDD0] flex items-center justify-center shrink-0">
                                  {v.image ? (
                                    <img src={getImageUrl(v.image)} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <ImageIcon size={18} className="text-[#C8B8AA]" />
                                  )}
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-[10px] font-black text-[#D4541C] cursor-pointer inline-flex items-center gap-1 hover:text-[#1A1410] transition-colors">
                                    <input
                                      type="file"
                                      accept="image/*,.heic,.heif"
                                      className="hidden"
                                      onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) handleVariantImageUpload(idx, file);
                                        event.target.value = "";
                                      }}
                                    />
                                    <Upload size={12} /> Image
                                  </label>
                                  {v.image && (
                                    <button
                                      type="button"
                                      onClick={() => updateVariant(idx, 'image', '')}
                                      className="text-left text-[10px] font-bold text-[#8A7A6D] hover:text-[#C73E1D]"
                                    >
                                      Retirer
                                    </button>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input
                                  type="text"
                                  value={v.size}
                                  onChange={e => updateVariant(idx, 'size', e.target.value)}
                                  placeholder="Taille"
                                  className="w-full bg-white border border-[#E8DDD0] rounded-md p-1.5 text-xs font-bold outline-none focus:border-[#D4541C]"
                                />
                                <input
                                  type="text"
                                  value={v.color}
                                  onChange={e => updateVariant(idx, 'color', e.target.value)}
                                  placeholder="Couleur"
                                  className="w-full bg-white border border-[#E8DDD0] rounded-md p-1.5 text-xs font-semibold outline-none focus:border-[#D4541C]"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                value={v.stock}
                                onChange={e => updateVariant(idx, 'stock', e.target.value)}
                                className="w-full bg-white border border-[#E8DDD0] rounded-md p-1.5 text-center font-bold outline-none focus:border-[#D4541C]"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                value={v.location}
                                onChange={e => updateVariant(idx, 'location', e.target.value)}
                                placeholder="A1-24"
                                className="w-full bg-[#FAF6F1]/30 border border-transparent hover:border-[#E8DDD0] rounded-md p-1.5 text-xs font-mono font-bold outline-none focus:border-[#D4541C] focus:bg-white transition-all"
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              {!v.id && (
                                <button type="button" onClick={() => removeVariant(idx)} className="text-[#C73E1D] hover:scale-110 transition-transform"><X size={16} /></button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-[#FDFCFB] border-t border-[#E8DDD0]">
                        <tr>
                          <td className="px-4 py-3"></td>
                          <td className="px-4 py-3 font-bold text-[11px] text-[#6B4838] uppercase">Total cumulé</td>
                          <td className="px-4 py-3 text-center text-lg font-black text-[#D4541C]">{variants.reduce((s, v) => s + v.stock, 0)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* COLONNE LATÉRALE (1/3) */}
          <div className="space-y-6">

            {/* CARD: STATUT & VISIBILITÉ */}
            <div className="bg-white border border-[#E8DDD0] rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-[#F8F5F2] bg-[#FDFCFB]">
                <h2 className="font-bold text-[#1A1410]">Statut</h2>
              </div>
              <div className="p-6 space-y-4">
                <label className="flex items-center gap-3 p-3 rounded-lg border-2 border-transparent hover:bg-[#FAF6F1] cursor-pointer transition-all">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                    !isUnpublished ? "bg-green-100 text-green-600" : "bg-[#FAF6F1] text-[#6B4838]"
                  )}>
                    <Check size={20} className={!isUnpublished ? "opacity-100" : "opacity-30"} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[13px] font-bold text-[#1A1410]">Actif</p>
                    <p className="text-[11px] text-[#6B4838]">Visible sur la boutique</p>
                  </div>
                  <input type="radio" checked={!isUnpublished} onChange={() => setIsUnpublished(false)} className="accent-[#D4541C] w-4 h-4" />
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border-2 border-transparent hover:bg-[#FAF6F1] cursor-pointer transition-all">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                    isUnpublished ? "bg-amber-100 text-amber-600" : "bg-[#FAF6F1] text-[#6B4838]"
                  )}>
                    <X size={20} className={isUnpublished ? "opacity-100" : "opacity-30"} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[13px] font-bold text-[#1A1410]">Brouillon</p>
                    <p className="text-[11px] text-[#6B4838]">Masqué pour les clients</p>
                  </div>
                  <input type="radio" checked={isUnpublished} onChange={() => setIsUnpublished(true)} className="accent-[#D4541C] w-4 h-4" />
                </label>

                <div className="pt-4 border-t border-[#F8F5F2]">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div className="flex items-center gap-2">
                      <Sparkles size={16} className={isFeatured ? "text-amber-500" : "text-[#6B4838]"} />
                      <span className="text-[13px] font-bold text-[#1A1410]">Mettre en avant</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isFeatured}
                      onChange={e => setIsFeatured(e.target.checked)}
                      className="w-5 h-5 accent-[#D4541C] rounded border-[#E8DDD0]"
                    />
                  </label>
                  <p className="text-[10px] text-[#6B4838] mt-2">Visible dans les sections Nouveautes ou Populaire.</p>
                </div>

                <div className="pt-4 border-t border-[#F8F5F2]">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div className="flex items-center gap-2">
                      <Plus size={16} className={isGift ? "text-[#D4541C]" : "text-[#6B4838]"} />
                      <span className="text-[13px] font-bold text-[#1A1410]">Produit cadeau</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isGift}
                      onChange={e => {
                        setIsGift(e.target.checked);
                        if (e.target.checked) setPrice(0);
                      }}
                      className="w-5 h-5 accent-[#D4541C] rounded border-[#E8DDD0]"
                    />
                  </label>
                  <p className="text-[10px] text-[#6B4838] mt-2">Le prix sera automatiquement fixé à 0 F.</p>
                </div>
              </div>
            </div>

            {/* CARD: ORGANISATION */}
            <div className="bg-white border border-[#E8DDD0] rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-[#F8F5F2] bg-[#FDFCFB]">
                <h2 className="font-bold text-[#1A1410]">Organisation</h2>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Catégorie</label>
                  <Select value={category || undefined} onValueChange={(val) => { if (val) { setCategory(val); setSubCategory(''); } }}>
                    <SelectTrigger className="w-full bg-white border border-[#E8DDD0] rounded-lg h-11 font-semibold focus:ring-2 focus:ring-[#D4541C]/10 outline-none">
                      <SelectValue placeholder="Choisir..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Sous-catégorie</label>
                  <Select value={subCategory || undefined} onValueChange={(val) => { if (val) setSubCategory(val === "none" ? "" : val); }}>
                    <SelectTrigger className="w-full bg-white border border-[#E8DDD0] rounded-lg h-11 font-semibold focus:ring-2 focus:ring-[#D4541C]/10 outline-none">
                      <SelectValue placeholder="Aucune" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Aucune</SelectItem>
                      {categories.find(c => c.name === category)?.subCategories?.map((s: any) => (
                        <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Fournisseur</label>
                  <SupplierCombobox suppliers={suppliers} value={supplier} onChange={setSupplier} />
                </div>

                {isAdmin && (
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Commercial attribuÃ©</label>
                    <Select value={selectedCreatorId || undefined} onValueChange={(val) => { if (val) setSelectedCreatorId(val); }}>
                      <SelectTrigger className="w-full bg-white border border-[#E8DDD0] rounded-lg h-11 font-semibold focus:ring-2 focus:ring-[#D4541C]/10 outline-none">
                        <SelectValue placeholder="Choisir un commercial..." />
                      </SelectTrigger>
                      <SelectContent>
                        {commercials.map((commercial) => (
                          <SelectItem key={commercial.id} value={commercial.id}>
                            {commercial.name || commercial.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Matière</label>
                    <input type="text" value={material} onChange={e => setMaterial(e.target.value)} placeholder="Ex: Coton" className="w-full border border-[#E8DDD0] rounded-lg p-2.5 text-sm font-semibold outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#6B4838]">Provenance</label>
                    <input type="text" value={origin} onChange={e => setOrigin(e.target.value)} placeholder="Ex: Adjamé" className="w-full border border-[#E8DDD0] rounded-lg p-2.5 text-sm font-semibold outline-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* CARD: LOGISTIQUE */}
            <div className="bg-white border border-[#E8DDD0] rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-[#F8F5F2] bg-[#FDFCFB]">
                <h2 className="font-bold text-[#1A1410]">Logistique</h2>
              </div>
              <div className="p-6">
                <div className="bg-[#FAF6F1] rounded-xl p-4 border border-[#E8DDD0]">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-[#D4541C] shadow-sm"><Warehouse size={16} /></div>
                    <span className="text-[13px] font-bold text-[#1A1410]">Lieu de stockage</span>
                  </div>
                  <Select value={selectedWarehouse || undefined} onValueChange={(val) => { if (val) setSelectedWarehouse(val); }}>
                    <SelectTrigger className="w-full bg-white border border-[#E8DDD0] rounded-lg h-11 font-bold text-sm shadow-none">
                      <SelectValue placeholder="Choisir..." />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-[#6B4838] mt-3 leading-relaxed">
                    Les quantités saisies seront initialisées dans cet entrepôt par défaut.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
