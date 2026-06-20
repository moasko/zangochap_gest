import { redirect } from "next/navigation";
import { getSession } from "@/modules/auth/actions";

export const dynamic = "force-dynamic";

export default async function LogisticsPage() {
  const user = await getSession();
  
  // Redirect based on role
  if (user?.role === 'packing') {
    redirect('/zangochap-manager/logistics/packing');
  } else if (user?.role === 'collection' || user?.role === 'point_relais') {
    redirect('/zangochap-manager/logistics/collection');
  } else {
    redirect('/zangochap-manager/logistics/packing');
  }
}
