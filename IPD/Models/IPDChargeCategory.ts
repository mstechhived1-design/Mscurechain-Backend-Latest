import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IIPDChargeCategory extends Document {
  name: string;
  hospital: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
}

const ipdChargeCategorySchema = new Schema<IIPDChargeCategory>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    hospital: { 
        type: Schema.Types.ObjectId, 
        ref: "Hospital", 
        required: true 
    },
    createdBy: { 
        type: Schema.Types.ObjectId, 
        ref: "User", 
        required: true 
    },
  },
  { timestamps: true }
);

ipdChargeCategorySchema.plugin(multiTenancyPlugin);

// Case-insensitive unique index per hospital
ipdChargeCategorySchema.index(
  { name: 1, hospital: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

const IPDChargeCategory = mongoose.model<IIPDChargeCategory>(
  "IPDChargeCategory",
  ipdChargeCategorySchema
);
export default IPDChargeCategory;
