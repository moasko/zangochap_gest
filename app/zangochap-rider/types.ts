import { OrderStatus } from "@prisma/client";

export interface RiderOrderItem {
  id: string;
  name: string;
  size: string;
  color: string;
  qty: number;
  price: number;
  emoji?: string | null;
  image?: string | null;
  isCustom: boolean;
  isGift: boolean;
  isDelivered: boolean;
}

export interface RiderOrder {
  id: string;
  ref: string;
  customerName: string;
  customerPhone: string;
  customerPhone2?: string | null;
  customerLocation?: string | null;
  commune?: string | null;
  total: number;
  deliveryFee: number;
  amountReceived?: number | null;
  deliveryNote?: string | null;
  notes?: string | null;
  deliveryDate?: string | null;
  lastDeliveryAttemptAt?: string | null;
  lastDeliveryAttemptRiderId?: string | null;
  lastDeliveryAttemptRiderName?: string | null;
  lastDeliveryAttemptStatus?: string | null;
  lastDeliveryAttemptReason?: string | null;
  status: OrderStatus;
  items: RiderOrderItem[];
  discount: number;
  isCommercialContacted?: boolean;
  returnReason?: string | null;
  updatedAt: string | Date;
  createdAt: string | Date;
  settlementId?: string | null;
  
  // Staff Info
  commercial?: {
    name: string;
    phone: string | null;
  } | null;
  packer?: {
    name: string;
    phone: string | null;
  } | null;
  collectors?: {
    name: string;
    phone: string | null;
  }[];
}

export interface RiderStats {
  cash: number;
  todayCash: number;
  amountToSettle: number;
  count: number;
  deliveredToday: number;
  partiallyDeliveredToday: number;
}

export interface RiderRevenueDay {
  key: string;
  label: string;
  orders: RiderOrder[];
  delivered: number;
  partial: number;
  settled: number;
  pending: number;
  total: number;
}
