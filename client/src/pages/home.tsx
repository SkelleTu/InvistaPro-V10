import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/dashboard/header.tsx";
import PortfolioOverview from "@/components/dashboard/portfolio-overview";
import ActionButtons from "@/components/dashboard/action-buttons";
import TransactionHistory from "@/components/dashboard/transaction-history";
import KycNotification from "@/components/kyc/kyc-notification";
import UserProfileModal from "@/components/profile/user-profile-modal";
import { Footer } from "@/components/ui/footer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X, Shield } from "lucide-react";
import investmentBgImage from "@assets/generated_images/Dark_investment_chart_background_ac2d4762.png";


export default function Home() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  



  // Redirect to home if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  if (isLoading) {
    return (
      <div 
        className="min-h-screen bg-gray-50 flex items-center justify-center relative"
        style={{
          backgroundImage: `url(${investmentBgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        <div className="absolute inset-0 backdrop-blur-md bg-background/30 mobile-backdrop-blur mobile-backdrop-enhanced"></div>
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary relative z-10"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div 
        className="flex-1 bg-background relative"
        style={{
          backgroundImage: `url(${investmentBgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
      {/* Background overlay with blur effect */}
      <div className="absolute inset-0 backdrop-blur-md bg-background/50 mobile-backdrop-blur mobile-backdrop-enhanced"></div>
      
      <div className="relative z-10">
        <Header />
        
        {/* KYC Notification */}
        <KycNotification />
        
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Security Reminder Banner */}
          <Alert className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 mb-6">
            <Shield className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 text-sm">
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
