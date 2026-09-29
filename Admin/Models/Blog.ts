import mongoose, { Schema, Document } from "mongoose";

export interface IBlog extends Document {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  author: string;
  featuredImage?: string;
  category: string;
  tags: string[];
  status: "draft" | "published";
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const blogSchema = new Schema<IBlog>(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    excerpt: { type: String, required: true },
    author: { type: String, default: "Super Admin" },
    featuredImage: { type: String },
    category: { type: String, required: true },
    tags: [{ type: String }],
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

// Add multi-tenancy plugin but disable scoping (since it's global content)
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
blogSchema.plugin(multiTenancyPlugin, {
  requireTenant: false,
  scoping: false,
});

blogSchema.index({ status: 1, publishedAt: -1, createdAt: -1 });

const Blog = mongoose.models.Blog || mongoose.model<IBlog>("Blog", blogSchema);
export default Blog;
