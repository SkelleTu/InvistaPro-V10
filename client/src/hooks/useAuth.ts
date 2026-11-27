import { useQuery } from "@tanstack/react-query";
import { User } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, error, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await fetch("/api/auth/user", {
        credentials: "include",
        cache: "no-store",
      });

      if (response.status === 401) {
        return null;
      }

      if (!response.ok) {
        let message = "Não foi possível validar a sessão.";
        try {
          const payload = await response.json();
          if (typeof payload?.message === "string" && payload.message.trim()) {
            message = payload.message;
          }
        } catch {
          // Mantém a mensagem segura e genérica quando a resposta não é JSON.
        }
        throw new Error(message);
      }

      return response.json();
    },
  });

  return {
    user,
    isLoading,
    authError: error,
    retryAuth: () => { void refetch(); },
    isAuthenticated: !!user && !error,
    isApproved: !!user?.contaAprovada,
    isPhoneVerified: !!user?.telefoneVerificado,
  };
}
