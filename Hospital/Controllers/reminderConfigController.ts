import { Request, Response } from 'express';
import ReminderConfiguration from '../Models/ReminderConfiguration.js';

export const getReminderConfig = async (req: any, res: Response) => {
    try {
        const hospitalId = req.user?.hospital;
        if (!hospitalId) return res.status(400).json({ message: 'Hospital ID not found in user session' });

        let config = await ReminderConfiguration.findOne({ hospital: hospitalId });

        // Return default if not found
        if (!config) {
            config = new ReminderConfiguration({
                hospital: hospitalId,
                enablePortalReminders: true,
                enableWhatsAppReminders: true,
                opdReminderSlots: [
                    { hour: 9, minute: 0, isEnabled: true },
                    { hour: 13, minute: 0, isEnabled: true },
                    { hour: 16, minute: 20, isEnabled: true },
                    { hour: 19, minute: 0, isEnabled: true }
                ],
                ipdReminderDays: [2, 1]
            });
        }

        res.status(200).json(config);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const updateReminderConfig = async (req: any, res: Response) => {
    try {
        const hospitalId = req.user?.hospital;
        if (!hospitalId) return res.status(400).json({ message: 'Hospital ID not found' });

        const { opdReminderSlots, ipdReminderDays, isActive, enablePortalReminders, enableWhatsAppReminders } = req.body;

        const updateData: any = {
            opdReminderSlots,
            ipdReminderDays,
        };
        if (typeof isActive === 'boolean') updateData.isActive = isActive;
        if (typeof enablePortalReminders === 'boolean') updateData.enablePortalReminders = enablePortalReminders;
        if (typeof enableWhatsAppReminders === 'boolean') updateData.enableWhatsAppReminders = enableWhatsAppReminders;

        const config = await ReminderConfiguration.findOneAndUpdate(
            { hospital: hospitalId },
            { $set: updateData },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // TRIGGER: Run reminders immediately after update so user sees instant results
        try {
            const { processFollowUpReminders, processDischargeFollowUpReminders } = await import('../../services/reminderService.js');
            processFollowUpReminders();
            processDischargeFollowUpReminders();
        } catch (e) {
            console.error("Error triggering reminders after update:", e);
        }

        res.status(200).json({
            success: true,
            message: 'Reminder configuration updated successfully',
            data: config
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};
