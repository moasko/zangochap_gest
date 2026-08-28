import React from 'react';
import PerformanceClient from './PerformanceClient';
import { getPerformanceStats } from "@/modules/orders/actions";

export const metadata = {
  title: 'Performance - Zangochap Manager',
};

export const dynamic = "force-dynamic";

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ dateFrom?: string, dateTo?: string }> }) {
  const { dateFrom, dateTo } = await searchParams;
  const stats = await getPerformanceStats(dateFrom, dateTo);

  return <PerformanceClient stats={stats} initialDateFrom={dateFrom || ""} initialDateTo={dateTo || ""} />;
}
