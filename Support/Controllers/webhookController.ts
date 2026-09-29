import { Response } from 'express';
import SupportRequest from '../Models/SupportRequest.js';
import { SupportRequestRequest } from '../types/index.js';
import { IUser } from '../../Auth/types/index.js';

/**
 * Webhook endpoint to receive status updates from external Support System
 * This endpoint is called by the Support System when ticket status changes
 * 
 * @route POST /api/support/webhook/status-update
 * @access Public (but protected by service token)
 */
export const handleSupportWebhook = async (req: SupportRequestRequest, res: Response): Promise<any> => {
    try {
        // 1. Verify the request is from Support System (check service token)
        const serviceToken = req.headers['x-service-token'] ||
            req.headers.authorization?.replace('Bearer ', '');

        const expectedToken = process.env.SUPPORT_SERVICE_TOKEN;

        if (!expectedToken || serviceToken !== expectedToken) {
            return res.status(403).json({
                success: false,
                message: 'Invalid or missing service token'
            });
        }

        // 2. Extract webhook data
        const {
            externalTicketId,  // The ticket ID from Support System
            ticketId,          // Our original MsCureChain ticket ID
            status,            // New status from Support System
            updatedBy,         // Who updated it in Support System
            updatedAt          // When it was updated
        } = req.body;

        // 3. Validate required fields
        if (!ticketId) {
            return res.status(400).json({
                success: false,
                message: 'ticketId is required'
            });
        }

        // 4. Find the ticket in MsCureChain database
        const ticket = await SupportRequest.findById(ticketId);

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found in MsCureChain'
            });
        }

        // 5. Map Support System status to MsCureChain status
        const statusMap: Record<string, 'open' | 'in-progress' | 'waiting' | 'resolved' | 'closed'> = {
            'Open': 'open',
            'In Progress': 'in-progress',
            'Closed': 'resolved',
            'Resolved': 'resolved'
        };

        const newStatus = statusMap[status] || ticket.status;

        // 6. Update ticket status in MsCureChain
        const oldStatus = ticket.status;
        ticket.status = newStatus as any;  // Type assertion needed due to Mongoose types

        // 7. Add a reply/note about the status change
        if (oldStatus !== newStatus) {
            ticket.replies.push({
                senderId: null as any,  // System update
                name: 'Support System',
                role: 'system',
                message: `Ticket status updated from "${oldStatus}" to "${newStatus}" by ${updatedBy || 'Support Team'} in Support Dashboard`,
                attachments: [],
                timestamp: updatedAt || new Date()
            } as any);
        }

        await ticket.save();

        console.log(`[Support Webhook] ✅ Ticket ${ticketId} status updated: ${oldStatus} → ${newStatus}`);

        // 8. Return success
        return res.status(200).json({
            success: true,
            message: 'Ticket status updated successfully',
            data: {
                ticketId: ticket._id,
                oldStatus,
                newStatus,
                updatedAt: ticket.updatedAt
            }
        });

    } catch (error: any) {
        console.error('[Support Webhook Error]:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to process webhook',
            error: error.message
        });
    }
};

/**
 * Health check endpoint for webhook
 * Support System can call this to verify the webhook URL is working
 * 
 * @route GET /api/support/webhook/health
 * @access Public
 */
export const webhookHealthCheck = async (req: SupportRequestRequest, res: Response): Promise<any> => {
    return res.status(200).json({
        success: true,
        message: 'MsCureChain Support Webhook is active',
        timestamp: new Date(),
        version: '1.0.0'
    });
};
