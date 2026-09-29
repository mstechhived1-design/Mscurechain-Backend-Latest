import axios from 'axios';

interface TicketSyncPayload {
    ticketId: string;
    userId: string;
    name: string;
    email?: string; // Optional to match IUser type
    role: string;
    subject: string;
    message: string;
    type: string;
    status: string;
    attachments?: string[];
    createdAt: Date;
}

interface SyncResponse {
    success: boolean;
    message?: string;
    externalTicketId?: string;
}

/**
 * External Support System Service
 * Handles API communication with the deployed Support Dashboard
 */
class ExternalSupportService {
    private baseUrl: string;
    private serviceToken: string;
    private enabled: boolean;

    constructor() {
        this.baseUrl = process.env.SUPPORT_SERVICE_BASE_URL || '';
        this.serviceToken = process.env.SUPPORT_SERVICE_TOKEN || '';
        this.enabled = !!(this.baseUrl && this.serviceToken);

        if (!this.enabled) {
            console.warn('[ExternalSupportService] Support System integration is disabled. Missing SUPPORT_SERVICE_BASE_URL or SUPPORT_SERVICE_TOKEN');
        }
    }

    /**
     * Sync a newly created ticket to the external Support Dashboard
     */
    async syncTicket(ticketData: TicketSyncPayload): Promise<SyncResponse> {
        if (!this.enabled) {
            return {
                success: false,
                message: 'Support System integration not configured'
            };
        }

        try {
            // Map MsCureChain fields to Support System expected fields
            const supportSystemPayload = {
                ticketId: ticketData.ticketId,
                title: ticketData.subject,                    // subject → title
                description: ticketData.message,              // message → description
                category: this.mapCategory(ticketData.type),  // type → category (Technical/Billing/General)
                priority: this.mapPriority(ticketData.status), // status → priority
                customerName: ticketData.name,                // name → customerName
                customerEmail: ticketData.email || '',        // email → customerEmail
                customerPhone: '',                            // Optional field
                role: ticketData.role,                        // Added role
                source: 'mscurechain',                        // Added source
                attachments: ticketData.attachments || []     // Added attachments
            };

            const response = await axios.post(
                `${this.baseUrl}/api/tickets/sync`,
                supportSystemPayload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.serviceToken}`,
                        'X-Service-Token': this.serviceToken
                    },
                    timeout: 10000 // 10 second timeout
                }
            );

            if (response.data?.success) {
                console.log(`[ExternalSupportService] ✅ Ticket synced successfully: ${ticketData.ticketId}`);
                return {
                    success: true,
                    externalTicketId: response.data.data?._id || response.data.ticketId || response.data.id
                };
            }

            console.warn(`[ExternalSupportService] ⚠️ Unexpected response:`, response.data);
            return {
                success: false,
                message: 'Unexpected response from Support System'
            };

        } catch (error: any) {
            const errorMsg = error.response?.data?.message || error.message || 'Unknown error';
            const statusCode = error.response?.status;

            console.error(`[ExternalSupportService] ❌ Failed to sync ticket ${ticketData.ticketId}:`, {
                status: statusCode,
                message: errorMsg,
                url: `${this.baseUrl}/api/tickets/sync`,
                responseData: error.response?.data
            });

            return {
                success: false,
                message: `Support System API error: ${errorMsg}`
            };
        }
    }

    /**
     * Map MsCureChain ticket type to Support System category
     */
    private mapCategory(type: string): string {
        const categoryMap: Record<string, string> = {
            'bug': 'Technical',
            'technical': 'Technical',
            'issue': 'Technical',
            'billing': 'Billing',
            'payment': 'Billing',
            'feedback': 'General',
            'question': 'General',
            'general': 'General'
        };
        return categoryMap[type.toLowerCase()] || 'General';
    }

    /**
     * Map ticket to Support System priority
     */
    private mapPriority(status?: string): string {
        // You can enhance this based on your requirements
        // For now, setting all as Medium priority
        return 'Medium';
    }

    /**
     * Check if the Support System API is reachable
     */
    async healthCheck(): Promise<boolean> {
        if (!this.enabled) return false;

        try {
            const response = await axios.get(`${this.baseUrl}/api/health`, {
                headers: {
                    'Authorization': `Bearer ${this.serviceToken}`
                },
                timeout: 5000
            });
            return response.status === 200;
        } catch (error) {
            console.error('[ExternalSupportService] Health check failed:', error);
            return false;
        }
    }

    /**
     * Get the dashboard URL for frontend integration
     */
    getDashboardUrl(): string {
        return process.env.SUPPORT_DASHBOARD_URL || '';
    }

    /**
     * Check if integration is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }
}

// Export singleton instance
export const externalSupportService = new ExternalSupportService();
export default externalSupportService;
