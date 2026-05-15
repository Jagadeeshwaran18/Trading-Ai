import os
lines = open('trading_signals_log.csv').readlines()
new_lines = []
for i, l in enumerate(lines):
    l = l.strip()
    p = l.split(',')
    if len(p) == 14:
        if i == 0:
            l += ',stop_loss,target,trailing_stoploss,trailing_target'
        else:
            l += ',N/A,N/A,N/A,N/A'
    new_lines.append(l + '\n')
open('trading_signals_log.csv', 'w').writelines(new_lines)
print("Fixed CSV")
