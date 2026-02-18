Prevent host-wide PID/thread starvation (highest priority)
Cap risky services so one process can’t starve SSH/Apache/systemd again.
# Example: cap MongoDB threads/tasks
sudo systemctl edit mongod
# Add:
[Service]
TasksMax=400
LimitNPROC=400
MemoryAccounting=true
MemoryHigh=350M
MemoryMax=500M
Restart=on-failure
RestartSec=5

# Example: cap Elasticsearch too (if you keep it)
sudo systemctl edit elasticsearch
# Add:
[Service]
TasksMax=500
LimitNPROC=500

sudo systemctl daemon-reload
sudo systemctl restart mongod elasticsearch
Then verify:
systemctl --no-pager show mongod -p TasksCurrent -p TasksMax
systemctl --no-pager show elasticsearch -p TasksCurrent -p TasksMax