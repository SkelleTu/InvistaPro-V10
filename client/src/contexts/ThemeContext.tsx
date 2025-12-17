import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'fluent';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // Ler do localStorage ou usar 'dark' como padrão
    const savedTheme = localStorage.getItem('investpro-theme');
    return (savedTheme as Theme) || 'dark';
  });

  useEffect(() => {
    // Salvar no localStorage
    localStorage.setItem('investpro-theme', theme);
    
    // Aplicar classe no html para CSS variables
    const root = document.documentElement;
    root.classList.remove('dark', 'fluent');
    
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'fluent') {
      root.classList.add('fluent');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(current => current === 'dark' ? 'fluent' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}