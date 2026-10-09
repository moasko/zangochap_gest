import Sidebar from "@/components/Sidebar";
import GlobalChatAccess from "@/components/GlobalChatAccess";
import GlobalNotesAccess from "@/components/GlobalNotesAccess";
import WhatsNewModal from "@/components/WhatsNewModal";
import GlobalDepositAlert from "@/components/GlobalDepositAlert";
import AppUpdateBanner from "@/components/AppUpdateBanner";
import ExchangePendingReminder from "@/modules/orders/components/ExchangePendingReminder";
import "./manager-layout.css";
import "./chat/chat.css";
import { getSession } from "@/modules/auth/actions";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zangochap Manager",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();

  if (!user) {
    return <>{children}</>;
  }

  const cleanUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    initials: user.initials
  };

  return (
    <div className="app-container">
      <Sidebar user={cleanUser} />
      <main className="main-content">
        {user.role === "commercial" && <ExchangePendingReminder key={user.id} />}
        <div className="main-scroll-area">
          {children}
        </div>
      </main>
      <GlobalChatAccess />
      {["ADMIN", "COMMERCIAL", "DEVELOPER"].includes(String(user.role).toUpperCase()) && (
        <GlobalNotesAccess />
      )}
      <WhatsNewModal role={user.role} />
      <AppUpdateBanner />
      {String(user.role).toUpperCase() === "COMMERCIAL" && <GlobalDepositAlert />}
    </div>
  );
}
