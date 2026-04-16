import { useState, useEffect, useCallback, useRef } from "react";
import { apiClient } from "../api/client";
import type { OrderSummaryDto } from "../types/api";

export interface UseOrdersOptions {
  page?: number;
  pageSize?: number;
  storeId?: number;
  clientId?: number;
  dateStart?: string;
  dateEnd?: string;
}

export interface UseOrdersResult {
  orders: OrderSummaryDto[];
  total: number;
  pages: number;
  currentPage: number;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  goToPage: (page: number) => Promise<void>;
}

export function useOrders(status: string, options: UseOrdersOptions = {}): UseOrdersResult {
  const { page = 1, pageSize = 50, storeId, clientId, dateStart, dateEnd } = options;

  const [orders, setOrders] = useState<OrderSummaryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(page);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fetchIdRef = useRef(0);

  const fetchOrders = useCallback(async (pageNum: number, isRefetch = false) => {
    const id = ++fetchIdRef.current;

    if (isRefetch) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await apiClient.listOrders({
        page: pageNum,
        pageSize,
        orderStatus: status,
        storeId,
        clientId,
        dateStart,
        dateEnd,
      });

      // Only apply if this is still the latest fetch
      if (id !== fetchIdRef.current) return;

      setOrders(response.orders);
      setTotal(response.total);
      setPages(response.pages);
      setCurrentPage(pageNum);
    } catch (err) {
      if (id !== fetchIdRef.current) return;
      const error = err instanceof Error ? err : new Error("Failed to fetch orders");
      setError(error);
      console.error("[useOrders]", error);
    } finally {
      if (id === fetchIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [status, pageSize, storeId, clientId, dateStart, dateEnd]);

  useEffect(() => {
    void fetchOrders(page);
  }, [fetchOrders, page]);

  const goToPage = useCallback(
    async (pageNum: number) => {
      await fetchOrders(pageNum);
    },
    [fetchOrders]
  );

  return {
    orders,
    total,
    pages,
    currentPage,
    loading,
    refreshing,
    error,
    refetch: () => fetchOrders(currentPage, true),
    goToPage,
  };
}
