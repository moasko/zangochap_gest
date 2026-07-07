import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/modules/auth/actions";

// Gestion des codes promo : creation/modification/suppression reservees aux
// admins. Sans cette garde, un anonyme pouvait creer un code -100% ou supprimer
// tous les codes par simple requete HTTP.
async function requireAdmin() {
  const session = await getSession();
  const role = String(session?.role || "").toLowerCase();
  if (!session || !["admin", "developer"].includes(role)) return null;
  return session;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });

    const data = await req.json();
    const { productIds, categoryIds, ...rest } = data;

    const promo = await prisma.promoCode.create({
      data: {
        code: rest.code,
        label: rest.label || rest.code,
        type: rest.type,
        value: rest.value || 0,
        giftProductId: rest.giftProductId || null,
        rule: rest.rule || 'UNLIMITED',
        minAmount: rest.minAmount || 0,
        minQuantity: rest.minQuantity || 0,
        maxGlobalUses: rest.maxGlobalUses || null,
        startDate: rest.startDate ? new Date(rest.startDate) : null,
        endDate: rest.endDate ? new Date(rest.endDate) : null,
        isActive: true,
        isAutomatic: rest.isAutomatic || false,
        // Le createur est la session courante, jamais une valeur fournie par le client.
        creatorId: session.id,
        products: productIds?.length ? {
          connect: productIds.map((id: string) => ({ id }))
        } : undefined,
        categories: categoryIds?.length ? {
          connect: categoryIds.map((id: string) => ({ id }))
        } : undefined,
      },
    });
    return NextResponse.json(promo);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });

    const data = await req.json();
    const { code, productIds, categoryIds } = data;

    // Liste blanche des champs modifiables : on n'accepte plus un spread {...rest}
    // qui laissait ecrire n'importe quelle colonne (creatorId, isActive, id...).
    const updateData: Record<string, unknown> = {};
    const setIfPresent = (key: string, transform?: (value: any) => unknown) => {
      if (data[key] === undefined) return;
      updateData[key] = transform ? transform(data[key]) : data[key];
    };
    setIfPresent("label");
    setIfPresent("type");
    setIfPresent("value");
    setIfPresent("giftProductId");
    setIfPresent("rule");
    setIfPresent("minAmount");
    setIfPresent("minQuantity");
    setIfPresent("maxGlobalUses");
    setIfPresent("isActive");
    setIfPresent("isAutomatic");
    setIfPresent("startDate", (value) => (value ? new Date(value) : null));
    setIfPresent("endDate", (value) => (value ? new Date(value) : null));

    if (productIds !== undefined) {
      updateData.products = { set: productIds.map((id: string) => ({ id })) };
    }
    if (categoryIds !== undefined) {
      updateData.categories = { set: categoryIds.map((id: string) => ({ id })) };
    }

    await prisma.promoCode.update({
      where: { code },
      data: updateData,
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });

    const code = req.nextUrl.searchParams.get('code');
    if (!code) return NextResponse.json({ error: 'Code requis' }, { status: 400 });
    await prisma.promoUsage.deleteMany({ where: { promoCode: code } });
    await prisma.promoCode.delete({ where: { code } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
