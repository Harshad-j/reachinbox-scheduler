local limit = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local window = 3600000
local base = math.floor(now / window) * window
local probes = tonumber(ARGV[5])
local delayed = 0
for offset = 0, probes do
  local suffix = ':' .. tostring(math.floor(base / window) + offset)
  local senderKey = KEYS[1] .. suffix
  local senderCount = redis.call('INCR', senderKey)
  if senderCount == 1 then redis.call('PEXPIRE', senderKey, ttl + offset * window) end
  local globalCount = 0
  if globalLimit > 0 then
    local globalKey = KEYS[2] .. suffix
    globalCount = redis.call('INCR', globalKey)
    if globalCount == 1 then redis.call('PEXPIRE', globalKey, ttl + offset * window) end
  end
  if senderCount <= limit and (globalLimit <= 0 or globalCount <= globalLimit) then
    return {offset, base + offset * window, 0, math.max(senderCount, globalCount), delayed}
  end
  redis.call('DECR', senderKey)
  if globalLimit > 0 then redis.call('DECR', KEYS[2] .. suffix) end
  if offset == 0 then
    local delayedKey = KEYS[1] .. ':delayed:' .. tostring(math.floor(base / window))
    delayed = redis.call('INCR', delayedKey)
    if delayed == 1 then redis.call('PEXPIRE', delayedKey, ttl) end
  end
end
return {probes, base + probes * window, 1, 0, delayed}
