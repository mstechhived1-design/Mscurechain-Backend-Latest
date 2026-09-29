import { Request, Response } from "express";
import Blog from "../Models/Blog.js";
import Testimonial from "../Models/Testimonial.js";
import ApiError from "../../utils/ApiError.js";
import redisService from "../../config/redis.js";

// ─── PUBLIC CACHE KEYS & TTL ─────────────────────────────────────────────────
const BLOGS_CACHE_KEY = "public:blogs:v1";
const TESTIMONIALS_CACHE_KEY = "public:testimonials:v1";
const PUBLIC_CACHE_TTL = 300; // 5 minutes

// ─── BLOGS ───────────────────────────────────────────────────────────────────

/**
 * @desc    Get all blogs (Public)
 * @route   GET /api/public/blogs
 * @access  Public
 *
 * FIX #3: Added Redis caching (5-min TTL) + .lean() to skip Mongoose
 * hydration. Previously every request was a cold MongoDB scan (~3-4s).
 * With cache, subsequent responses are served in <5ms.
 */
export const getPublicBlogs = async (req: Request, res: Response) => {
  try {
    // 1. Try Redis cache first
    const cached = await redisService.get<any[]>(BLOGS_CACHE_KEY);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json({ success: true, data: cached });
    }

    // 2. Cache miss — query MongoDB with .lean() for raw JS objects (40% faster)
    const blogs = await (Blog.find({ status: "published" })
      .sort({ publishedAt: -1, createdAt: -1 })
      .lean() as any).unscoped();

    // 3. Populate cache asynchronously so we don't hold the response
    redisService.set(BLOGS_CACHE_KEY, blogs, PUBLIC_CACHE_TTL).catch(() => {});

    res.setHeader("X-Cache", "MISS");
    return res.json({ success: true, data: blogs });
  } catch (error: any) {
    console.error("[getPublicBlogs] Error:", error);
    res.status(500).json({ success: false, message: error.message, stack: process.env.NODE_ENV === "development" ? error.stack : undefined });
  }
};

/**
 * @desc    Get all blogs (Admin)
 * @route   GET /api/admin/blogs
 * @access  Private/SuperAdmin
 */
export const getAdminBlogs = async (req: Request, res: Response) => {
  try {
    const blogs = await (Blog.find().sort({ createdAt: -1 }) as any).unscoped();
    res.json({ success: true, data: blogs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Create a blog
 * @route   POST /api/admin/blogs
 * @access  Private/SuperAdmin
 */
/**
 * Cache invalidation helper — called after any write operation.
 */
const invalidateBlogCache = async () => {
  await redisService.del(BLOGS_CACHE_KEY).catch(() => {});
};

export const createBlog = async (req: Request, res: Response) => {
  try {
    console.log('[CMS] Creating blog with body:', JSON.stringify(req.body, null, 2));
    const { title, content, excerpt, category, tags, featuredImage, status } = req.body;
    
    if (!title) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    // Use provided slug or generate from title
    let baseSlug = req.body.slug || title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    
    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const existing = await (Blog.findOne({ slug }) as any).unscoped();
      if (!existing) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const blog = await Blog.create({
      title,
      slug,
      content,
      excerpt,
      category,
      tags,
      featuredImage,
      status,
      publishedAt: status === "published" ? new Date() : undefined,
    });

    await invalidateBlogCache();
    res.status(201).json({ success: true, data: blog });
  } catch (error: any) {
    console.error('[CMS] Create blog error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Update a blog
 * @route   PUT /api/admin/blogs/:id
 * @access  Private/SuperAdmin
 */
export const updateBlog = async (req: Request, res: Response) => {
  try {
    const { status, slug: reqSlug } = req.body;
    if (status === "published" && !req.body.publishedAt) {
      req.body.publishedAt = new Date();
    }

    if (reqSlug) {
      let baseSlug = reqSlug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      let checkedSlug = baseSlug;
      let counter = 1;
      while (true) {
        const existing = await (Blog.findOne({ slug: checkedSlug, _id: { $ne: req.params.id } }) as any).unscoped();
        if (!existing) break;
        checkedSlug = `${baseSlug}-${counter}`;
        counter++;
      }
      req.body.slug = checkedSlug;
    }

    const blog = await (Blog.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }) as any).unscoped();

    if (!blog) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    await invalidateBlogCache();
    res.json({ success: true, data: blog });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Delete a blog
 * @route   DELETE /api/admin/blogs/:id
 * @access  Private/SuperAdmin
 */
export const deleteBlog = async (req: Request, res: Response) => {
  try {
    const blog = await (Blog.findByIdAndDelete(req.params.id) as any).unscoped();
    if (!blog) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }
    await invalidateBlogCache();
    res.json({ success: true, message: "Blog deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── TESTIMONIALS ─────────────────────────────────────────────────────────────

/**
 * @desc    Get all testimonials (Public)
 * @route   GET /api/public/testimonials
 * @access  Public
 */
export const getPublicTestimonials = async (req: Request, res: Response) => {
  try {
    // Cache testimonials too
    const cached = await redisService.get<any[]>(TESTIMONIALS_CACHE_KEY);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json({ success: true, data: cached });
    }

    const testimonials = await (Testimonial.find({ status: "active" })
      .sort({ createdAt: -1 })
      .lean() as any).unscoped();

    redisService.set(TESTIMONIALS_CACHE_KEY, testimonials, PUBLIC_CACHE_TTL).catch(() => {});
    res.setHeader("X-Cache", "MISS");
    return res.json({ success: true, data: testimonials });
  } catch (error: any) {
    console.error("[getPublicTestimonials] Error:", error);
    res.status(500).json({ success: false, message: error.message, stack: process.env.NODE_ENV === "development" ? error.stack : undefined });
  }
};

/**
 * @desc    Get all testimonials (Admin)
 * @route   GET /api/admin/testimonials
 * @access  Private/SuperAdmin
 */
export const getAdminTestimonials = async (req: Request, res: Response) => {
  try {
    const testimonials = await (Testimonial.find().sort({ createdAt: -1 }) as any).unscoped();
    res.json({ success: true, data: testimonials });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Create a testimonial
 * @route   POST /api/admin/testimonials
 * @access  Private/SuperAdmin
 */
export const createTestimonial = async (req: Request, res: Response) => {
  try {
    const testimonial = await Testimonial.create(req.body);
    res.status(201).json({ success: true, data: testimonial });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Update a testimonial
 * @route   PUT /api/admin/testimonials/:id
 * @access  Private/SuperAdmin
 */
export const updateTestimonial = async (req: Request, res: Response) => {
  try {
    const testimonial = await (Testimonial.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }) as any).unscoped();

    if (!testimonial) {
      return res.status(404).json({ success: false, message: "Testimonial not found" });
    }

    res.json({ success: true, data: testimonial });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Delete a testimonial
 * @route   DELETE /api/admin/testimonials/:id
 * @access  Private/SuperAdmin
 */
export const deleteTestimonial = async (req: Request, res: Response) => {
  try {
    const testimonial = await (Testimonial.findByIdAndDelete(req.params.id) as any).unscoped();
    if (!testimonial) {
      return res.status(404).json({ success: false, message: "Testimonial not found" });
    }
    res.json({ success: true, message: "Testimonial deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
