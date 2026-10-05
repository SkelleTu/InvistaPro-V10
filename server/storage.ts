      .delete(activeTradingSessions)
      .where(eq(activeTradingSessions.isActive, false));
  }

  async saveWebSocketSubscription(subscription: InsertActiveWebSocketSubscription): Promise<ActiveWebSocketSubscription> {
    const existing = await db
      .select()
      .from(activeWebSocketSubscriptions)
      .where(eq(activeWebSocketSubscriptions.subscriptionId, subscription.subscriptionId))
      .limit(1);

    if (existing[0]) {
      const [updated] = await db
        .update(activeWebSocketSubscriptions)
        .set({
          symbol: subscription.symbol,
          subscriptionType: subscription.subscriptionType,
          isActive: true,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(activeWebSocketSubscriptions.subscriptionId, subscription.subscriptionId))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(activeWebSocketSubscriptions)
      .values(subscription)
      .returning();
    return created;
  }

  async getActiveWebSocketSubscriptions(): Promise<ActiveWebSocketSubscription[]> {
    return await db
      .select()
      .from(activeWebSocketSubscriptions)
      .where(eq(activeWebSocketSubscriptions.isActive, true));
  }

  async deactivateWebSocketSubscription(subscriptionId: string): Promise<void> {
    await db
      .update(activeWebSocketSubscriptions)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(activeWebSocketSubscriptions.subscriptionId, subscriptionId));
  }

  async clearAllWebSocketSubscriptions(): Promise<void> {
    await db
      .delete(activeWebSocketSubscriptions)
      .where(eq(activeWebSocketSubscriptions.isActive, false));
  }

  async updateSystemHeartbeat(componentName: string, status: string, metadata?: any, lastError?: string): Promise<void> {
    const existing = await this.getSystemHeartbeat(componentName);