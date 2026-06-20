import { Metadata, Viewport } from "next";
import GlobalChatAccess from "@/components/GlobalChatAccess";
import { getSession } from "@/modules/auth/actions";
import { redirect } from "next/navigation";
import "../zangochap-manager/chat/chat.css";

export const metadata: Metadata = {
  title: "ZangoChap Rider",
  description: "Espace de livraison ZangoChap",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#F5F5F7",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RiderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  const role = user?.role?.toUpperCase();

  if (!user || (role !== "LIVREUR" && role !== "ADMIN" && role !== "DEVELOPER")) {
    redirect("/zangochap-manager");
  }

  return (
    <div className="rider-root">
      {children}
      <GlobalChatAccess />
      <style>{`
        .rider-root {
          min-height: 100vh;
          min-height: 100dvh;
          width: 100%;
          background: #F5F5F7;
          color: #1C1C1E;
          font-family: 'Outfit', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        body {
          background-color: #F5F5F7 !important;
          overscroll-behavior-y: none;
          overflow-x: hidden;
        }
        .rider-root ::-webkit-scrollbar { display: none; }
        .rider-root * {
          -ms-overflow-style: none;
          scrollbar-width: none;
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>
    </div>
  );
}
