import mongoose, { Schema, Document } from "mongoose";

export interface ITestimonial extends Document {
  name: string;
  designation: string;
  company?: string;
  content: string;
  avatar?: string;
  rating: number;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

const testimonialSchema = new Schema<ITestimonial>(
  {
    name: { type: String, required: true },
    designation: { type: String, required: true },
    company: { type: String },
    content: { type: String, required: true },
    avatar: { type: String },
    rating: { type: Number, required: true, min: 1, max: 5, default: 5 },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true }
);

// Add multi-tenancy plugin but disable scoping (since it's global content)
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
testimonialSchema.plugin(multiTenancyPlugin, {
  requireTenant: false,
  scoping: false,
});

const Testimonial = mongoose.models.Testimonial || mongoose.model<ITestimonial>("Testimonial", testimonialSchema);
export default Testimonial;
