# Production Resource Audit Report (MongoDB & Cloudinary)

This document provides a detailed breakdown of the current data storage, occupied space, remaining capacity, and usage statistics for both the **MongoDB Atlas** database and the **Cloudinary** media storage. 

* **Audit Date:** June 30, 2026
* **Environment:** Production

---

## 1. MongoDB Atlas (M0 Free Tier)

Below is the usage status of the primary database `curechain` running on MongoDB Atlas M0 free tier.

| Parameter / Metric | Value | Notes / Description |
| :--- | :--- | :--- |
| **Database Name** | `curechain` | The multi-tenant database name |
| **Total Collections** | `118` | Total number of data models/tables |
| **Total Documents** | `19,452` | Total rows of data stored |
| **Average Document Size** | `770.15 Bytes` | Average size of a single document |
| **Logical Data Size** | `14.29 MB` (14,629.83 KB) | Actual size of raw data |
| **Storage Size** | `18.21 MB` (18,648.00 KB) | Physical space occupied (compressed by WiredTiger) |
| **Index Size** | `21.33 MB` (21,844.00 KB) | Space occupied by database indexes |
| **Total Occupied Size** | **39.54 MB** | Combined Storage Size + Index Size |
| **Free Tier Limit** | **512.00 MB** | Maximum limit of MongoDB Atlas M0 |
| **Remaining Space** | **472.46 MB** | Available space remaining |
| **Space Usage %** | **7.72%** | **Safe** (Low usage) |

> [!NOTE]
> MongoDB database storage is optimized; indexes occupy slightly more space than compressed data to ensure fast queries. You are currently using only **7.72%** of your free storage limit.

---

## 2. Cloudinary Media Storage (Free Plan)

Below is the usage status of your Cloudinary cloud media repository (`dnjxgcl3f`) under the unified Credit Pool system.

### Plan Credits Overview
* **Plan Name:** `Free`
* **Total Credit Pool Limit:** **25 Credits** per month
* **Total Credits Used:** **1.89 Credits**
* **Remaining Pool:** **23.11 Credits**
* **Overall Plan Usage %:** **7.56%**

### Resource Usage Breakdown

| Resource Type | Actual Usage | Credit Weight | Equivalencies & Potential |
| :--- | :--- | :--- | :--- |
| **Managed Storage** | `570.61 MB` | `0.56 credits` | 1 Credit = 1.00 GB of Storage |
| **Bandwidth (Viewing)** | `1.32 GB` | `1.32 credits` | 1 Credit = 1.00 GB of Bandwidth |
| **Transformations** | `12` transformations | `0.01 credits` | 1 Credit = 1,000 Transformations |
| **Potential Remaining** | **23.11 GB** | *N/A* | Max potential remaining storage/bandwidth |

> [!TIP]
> Under Cloudinary's Credit System, your remaining **23.11 credits** can be used flexibly. For example, you could store up to an additional **23.11 GB** of media assets or handle up to **23.11 GB** of asset delivery bandwidth this month.

---

## 3. Key Takeaways & Recommendations

1. **No Upgrades Required:** Both systems are highly optimized and operating well within their free limits (MongoDB at **7.72%** capacity and Cloudinary at **7.56%** capacity). No subscription upgrade is needed at this stage.
2. **Dynamic Scaling Options:**
   - If MongoDB storage reaches 80% (around 410 MB), it is recommended to upgrade to a shared M2/M5 tier or dedicated M10 cluster.
   - If Cloudinary usage exceeds 20 credits, moving to the Plus plan or compressing images prior to upload will help stay within boundaries.
