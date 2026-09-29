// utils/validators.ts
import { body } from "express-validator";

/**
 * PASSWORD POLICY (Multi-Tenant Security)
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 digit
 * - At least 1 special character
 */
const passwordPolicy = body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one digit')
    .matches(/[@$!%*?&#^()_+\-=]/)
    .withMessage('Password must contain at least one special character');

export const registerValidator = [
    body('name')
        .notEmpty().withMessage('Name is required')
        .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters')
        .trim()
        .escape(),
    body('mobile')
        .notEmpty().withMessage('Mobile required'),
    body('email')
        .if(body('platform').not().equals('mobile'))
        .notEmpty().withMessage('Email required for web registration')
        .isEmail().withMessage('Valid email is required')
        .normalizeEmail(),
    body('email')
        .if(body('platform').equals('mobile'))
        .optional({ checkFalsy: true })
        .isEmail().withMessage('Valid email is required')
        .normalizeEmail(),
    body('platform').optional(),
    passwordPolicy,
    body('consentGiven')
        .isBoolean().withMessage('Consent is required'),
    // Prevent role injection — disallow super-admin from general registration
    body('role')
        .optional()
        .custom((value) => {
            const forbidden = ['super-admin', 'superadmin', 'admin'];
            if (forbidden.includes(value?.toLowerCase().trim())) {
                throw new Error('This role cannot be assigned via public registration');
            }
            return true;
        }),
];

export const loginValidator = [
    body().custom((value, { req }) => {
        if (!req.body.mobile && !req.body.identifier && !req.body.logid) {
            throw new Error('Mobile, Doctor ID or Log ID is required');
        }
        return true;
    }),
    body('password').notEmpty().withMessage('Password is required')
];

export const superAdminLoginValidator = [
    body('password').notEmpty().withMessage('Password is required'),
    body().custom((value, { req }) => {
        if (!req.body.loginId && !req.body.email && !req.body.mobile) {
            throw new Error('Login ID, email, or mobile is required');
        }
        return true;
    }),
];

export const superAdminRegisterValidator = [
    body('name')
        .notEmpty().withMessage('Name is required')
        .trim()
        .escape(),
    body('email')
        .isEmail().withMessage('Valid email is required')
        .normalizeEmail(),
    passwordPolicy,
];

export const otpSendValidator = [
    body('mobile').notEmpty().withMessage('Mobile required'),
    body('email').isEmail().withMessage('Valid email is required')
];

export const otpVerifyValidator = [
    body('mobile').notEmpty().withMessage('Mobile required'),
    body('otp').notEmpty().withMessage('OTP is required')
];

export const refreshValidator = [
    body('refreshToken').notEmpty().withMessage('Refresh token is required')
];

export const resetPwdValidator = [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('newPwd').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
        .matches(/[A-Z]/).withMessage('Must contain at least one uppercase letter')
        .matches(/[0-9]/).withMessage('Must contain at least one digit')
        .matches(/[@$!%*?&#^()_+\-=]/).withMessage('Must contain at least one special character')
];

export const changePasswordValidator = [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
        .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
        .matches(/[A-Z]/).withMessage('Must contain at least one uppercase letter')
        .matches(/[a-z]/).withMessage('Must contain at least one lowercase letter')
        .matches(/[0-9]/).withMessage('Must contain at least one digit')
        .matches(/[@$!%*?&#^()_+\-=]/).withMessage('Must contain at least one special character'),
];
