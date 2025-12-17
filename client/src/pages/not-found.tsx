import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";
import investmentBgImage from "@assets/generated_images/Dark_investment_chart_background_ac2d4762.png";

export default function NotFound() {
  const handleGoHome = () => {
    window.location.href = "/";
  };

  return (
    <div 
      className="min-h-screen w-full flex items-center justify-center bg-background relative"
      style={{
        backgroundImage: `url(${investmentBgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      {/* Background overlay with blur effect */}
      <div className="absolute inset-0 backdrop-blur-md bg-background/30 mobile-backdrop-blur mobile-backdrop-enhanced"></div>
      <Card className="w-full max-w-md mx-4 bg-card border-border relative z-10">
        <CardContent className="pt-6 p-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">404 - Página não encontrada</h1>
            <p className="text-sm text-muted-foreground">
              A página que você está procurando não existe ou foi movida.
            </p>
            <Button 
              onClick={handleGoHome}
              className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground"
              data-testid="button-go-home"
            >
              <Home className="h-4 w-4 mr-2" />
              Voltar ao Início
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
