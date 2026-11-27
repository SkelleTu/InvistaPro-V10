import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import PortfolioOverview from "@/components/dashboard/portfolio-overview";
import ActionButtons from "@/components/dashboard/action-buttons";
import TransactionHistory from "@/components/dashboard/transaction-history";
import KycNotification from "@/components/kyc/kyc-notification";
import UserProfileModal from "@/components/profile/user-profile-modal";
import { Footer } from "@/components/ui/footer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X, Shield } from "lucide-react";


export default function Home() {
  const { isLoading, user } = useAuth();
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  




  if (isLoading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center relative">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary relative z-10"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 bg-transparent relative">
      
      <div className="relative z-10">
        
        {/* KYC Notification */}
        <KycNotification />
        
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Security Reminder Banner */}
          <Alert className="bg-cyan-400/5 border-cyan-400/20 mb-6">
            <Shield className="h-4 w-4 text-cyan-300" />
            <AlertDescription className="text-zinc-200 text-sm">
              <strong>Lembrete de Segurança:</strong> Mantenha seus dados seguros. Nunca compartilhe login/senha. Acesse sempre por nosso domínio oficial. Em caso de suspeita, entre em contato conosco.
            </AlertDescription>
          </Alert>
          
          <PortfolioOverview />
          <ActionButtons />
          <TransactionHistory />
        </main>
      </div>

        {/* Profile Modal */}
        <UserProfileModal 
          isOpen={profileModalOpen} 
          onClose={() => setProfileModalOpen(false)} 
        />
      </div>
      
      {/* Footer */}
      <Footer />
    </div>
  );
}
