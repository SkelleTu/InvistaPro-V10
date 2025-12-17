import { useQuery } from "@tanstack/react-query";
import { User } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: false,
    refetchOnWindowFocus: false, // Evita verificações desnecessárias
    queryFn: async () => {
      try {
        const response = await fetch("/api/auth/user", {
          credentials: 'include',
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null; // Usuário não está logado
          }
          throw new Error('Falha ao verificar autenticação');
        }
        
        return response.json();
      } catch (error) {
        console.log('Verificação de autenticação: usuário não logado');
        return null; // Em caso de erro, assume que não está logado
      }
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    isApproved: !!user?.contaAprovada,
    isPhoneVerified: !!user?.telefoneVerificado,
  };
}
