"use client";
 
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, ShoppingBag, Truck, Settings, Package, Landmark
} from "lucide-react";
 
interface MobileNavProps {
  user: {
    role: string;
  };
}
 
export default function MobileNav({ user }: MobileNavProps) {
  const pathname = usePathname();
 
  const isAdmin = user.role === 'admin' || user.role === 'developer';
  const isLivreur = user.role === 'livreur';
  const isPacking = user.role === 'packing';
  const isCollection = user.role === 'collection';
  const isComptable = user.role === 'comptable';
 
  // Main links for bottom nav
  const items = [
    { label: 'Dashboard', href: '/zangochap-manager/dashboard', icon: <LayoutDashboard size={22} /> },
    { label: 'Commandes', href: '/zangochap-manager/orders', icon: <ShoppingBag size={22} /> },
  ];
 
  if (isAdmin || isPacking || isCollection) {
    items.push({ label: 'Logistique', href: isPacking ? '/zangochap-manager/logistics/packing' : (isCollection ? '/zangochap-manager/logistics/collection' : '/zangochap-manager/logistics'), icon: <Package size={22} /> });
  }
 
  if (isLivreur) {
    items.push({ label: 'Mes courses', href: '/zangochap-rider', icon: <Truck size={22} /> });
  }

  if (isComptable) {
    items.push({ label: 'Compta', href: '/zangochap-manager/accounting', icon: <Landmark size={22} /> });
  }
 
  if (isAdmin) {
    items.push({ label: 'Réglages', href: '/zangochap-manager/admin/settings', icon: <Settings size={22} /> });
  }
 
  return (
    <div className="mobile-bottom-nav">
      {items.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link 
            key={item.href} 
            href={item.href} 
            className={`nav-item-mobile ${isActive ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
