# InvistaPRO Financial Platform

## Overview
InvistaPRO is a comprehensive Brazilian financial investment platform promising returns up to 130% compared to major Brazilian banks, operating under the motto "Invest with Zero Risk." The platform includes a complete user registration system, KYC verification, PIX integration, portfolio management, and an administrative panel. It features an automated trading system with AI cooperative analysis to identify profitable opportunities across various markets, ensuring high availability and data persistence through a dual-database system. The project aims to capture a significant share of the investment market by offering high returns with perceived low risk and a robust, secure, and user-friendly experience.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript and Vite
- **UI Framework**: Tailwind CSS with shadcn/ui (professional dark/black theme)
- **State Management**: TanStack Query (React Query)
- **Routing**: Wouter for lightweight client-side routing
- **Styling**: Tailwind CSS with CSS variables, optimized for mobile

### Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful API for authentication, financial operations, and user management
- **Database ORM**: Drizzle ORM for type-safe database operations
- **Session Management**: Express sessions with PostgreSQL storage

### Authentication & Authorization
- **Provider**: Email verification with a 6-digit code
- **Session Storage**: PostgreSQL-backed sessions
- **Authorization**: Middleware-based route protection
- **Security**: Multi-level security (email verification, document verification, biometric authentication for high-value withdrawals)
- **Biometric Security**: Proprietary "InvestPro-Secure-Auth" engine for facial recognition

### Database Design
- **Dual Database System**: SQLite + PostgreSQL synchronized in real-time. PostgreSQL is the primary database for production and persistence across Replit remixes, while SQLite serves as a local backup and automatic fallback.
- **Schema Management**: Drizzle ORM with separate schemas for each database.
- **Synchronization**: DualStorage layer with a dual-write pattern for simultaneous writes and intelligent read fallback.
- **Key Tables**: Users, Movements, Documents, Sessions, Trade_operations, AI_logs, Daily_PnL.
- **Failover**: Automatic failover when one database becomes unavailable.
- **Migration**: `server/migrate-postgres.ts` script for PostgreSQL setup.

### Financial Operations
- **Yield Calculation**: 0.835% monthly (10.63% annual compounded).
- **Investment Rules**: Minimum deposit R$130; monthly yield withdrawals; total withdrawal after 95 days with document verification; biometric verification for withdrawals > R$300.
- **Transaction Tracking**: Comprehensive logging of all financial movements.
- **KYC Compliance**: Document upload system for verification.

### Automated Trading System
- **Core Functionality**: Real-time analysis of 100+ symbols (Forex, Indices, Synthetics, Crypto) using AI Cooperative Analysis.
- **Execution**: Automated execution of Digit Differs operations based on AI consensus.
- **Safety Controls**: Emergency stop, administrative approval requirement, session limits (per session and daily), and diagnostic/auto-fix tools.
- **Scheduler Control**: START/STOP functionality via dashboard with auto-initialization and robust lifecycle management to prevent race conditions.
- **Keep-Alive**: Internal, ultra-aggressive 2-layer ping system to maintain process activity (20-second primary, 15-second backup).

### Development & Build Pipeline
- **Development**: Vite development server.
- **Building**: Vite for frontend, esbuild for backend.
- **Type Safety**: Shared TypeScript schemas via Zod validation.
- **Error Handling**: Runtime error overlay and structured error responses.

### UI/UX Decisions
- **Color Scheme**: Professional dark/black theme with optimized contrast.
- **Component Design**: shadcn/ui components with CSS variables updated for the dark theme.
- **User Flow**: Optimized deposit button overlay, improved biometric login experience, simplified authentication.
- **Mobile Optimization**: Responsive interface with specific mobile optimizations.

## External Dependencies

### Core Services
- **Database**: PostgreSQL (Neon-backed via Replit).
- **Email Service**: SendGrid + proprietary InvestPro autonomous system.
- **File Storage**: Local file system with Multer.
- **Frontend Components**: Radix UI primitives (via shadcn/ui).

### Brazilian Market Integrations
- **Payment Processing**: PIX payment system (PagBank/PagSeguro integration).
- **Address Validation**: ViaCEP API for Brazilian ZIP code validation.
- **Document Validation**: CPF validation algorithm.
- **Phone Validation**: Brazilian phone number format validation.

### Marketing & Communication
- **WhatsApp Integration**: `whatsapp-web.js` for administrative notifications.
- **Market Data**: CDI/Selic real-time rates integration.

### Trading System Integration
- **Real-time Market Data**: Deriv API (WebSocket connection) for 100+ symbols.

### Development Tools
- **Cron Jobs**: `node-cron` for automated processing.
- **Security**: Crypto module for biometric data hashing.