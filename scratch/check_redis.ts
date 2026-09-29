import redisService from '../config/redis.js';

async function check() {
    const cacheKey = `auth:user:v2:69a7b14ec84f8f6e66180903`;
    const cachedUser = await redisService.get(cacheKey);
    console.log("REDIS CACHED USER:", JSON.stringify(cachedUser, null, 2));
    
    // Let's delete the cache key to force a DB reload
    await redisService.del(cacheKey);
    console.log("DELETED REDIS CACHE KEY");
    
    process.exit(0);
}

check();
