import Topbar from "@/components/Topbar";
import { getChatSnapshot } from "@/modules/chat/actions";
import ChatClient from "./ChatClient";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const snapshot = await getChatSnapshot();

  return (
    <>
      <Topbar title="Chat" subtitle="equipe" />
      <ChatClient initialSnapshot={snapshot} />
    </>
  );
}
