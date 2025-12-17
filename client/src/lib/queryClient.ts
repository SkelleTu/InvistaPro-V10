import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    
    try {
      const text = await res.text();
      if (text) {
        // Try to parse as JSON first to get the proper error message
        try {
          const jsonError = JSON.parse(text);
          errorMessage = jsonError.message || text;
        } catch {
          // If not JSON, use the raw text
          errorMessage = text;
        }
      }
    } catch (e) {
      // If we can't read the response body, use status text
      errorMessage = res.statusText;
    }
    
    throw new Error(errorMessage);
  }
}

export async function apiRequest(
  url: string,
  options?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  }
): Promise<Response> {
  const { method = 'GET', body, headers = {} } = options || {};
  
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
