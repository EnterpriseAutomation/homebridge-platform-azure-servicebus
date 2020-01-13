// var SQSWorker = require('sqs-worker');
const { ServiceBusClient, ReceiveMode } = require("@azure/service-bus");

var Accessory, Service, Characteristic, UUIDGen;



module.exports = function(homebridge) {

  // Accessory must be created from PlatformAccessory Constructor
  Accessory = homebridge.platformAccessory;

  // Service and Characteristic are from hap-nodejs
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  // For platform plugin to be considered as dynamic platform plugin,
  // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
  homebridge.registerPlatform("homebridge-platform-azure-servicebus", "AzureServiceBus", AzureServiceBusPlatform, true);
}

function AzureServiceBusPlatform(log, config, api) {

  //just capture the input, we'll set it up in accessories
  this.log = log;
  this.config = config;
  this.api = api;
}

AzureServiceBusPlatform.prototype = {
  accessories: function(callback) {
    //For each device in cfg, create an accessory!
    var foundAccessories = this.config.accessories;
    var myAccessories = [];

    for (var i = 0; i < foundAccessories.length; i++) {
      var accessory = new AzureServiceBusAccessory(this.log, foundAccessories[i]);
      myAccessories.push(accessory);
      this.log('Created ' + accessory.name + ' Accessory');
    }
    callback(myAccessories);
  },
  removeAccessory: function(accessory) {
    if (accessory) {
      this.api.unregisterPlatformAccessories("homebridge-amazondash", "AmazonDash", [accessory]);
    }
  }
}


//an accessorary, eg a button. This one is mostly just an on/off state button.
//SQS message toggles it, as does pressing it in the home app
function AzureServiceBusAccessory(log, accessory) {
  this.log = log;
  this.accessory = accessory;
  this.name = this.accessory.name;
  this.buttonIsOn = false;
  this.startListener();
}

AzureServiceBusAccessory.prototype = {
  startListener: function() {
    var self = this;

    this.queueName = this.accessory.queueName;
    this.serviceBusClient = ServiceBusClient.createFromConnectionString(this.accessory.connectionString);
    this.queueClient = this.serviceBusClient.createQueueClient(this.queueName);
    this.receiver = this.queueClient.createReceiver(ReceiveMode.receiveAndDelete);
    
    this.receiver.registerMessageHandler(function (brokeredMessage) {
      self.log("message received: " + brokeredMessage.body);
    
      var obj = brokeredMessage.body;

      if(obj.target === self.name)
      {
        self.log("found incoming message for '" + self.name + "' which is this accessory, processing.");
      }
      else
      {
        self.log("got incoming message for another accessory ('" + self.name + "') ignoring.");
        return;
      }

      self.toggleButton();  
    },
    function (err) {
      self.log("error occured: " + err);
    },
    {
      autoComplete: true
    });
  },

  toggleButton: function() {
    //toggle the internal state of the button
    this.buttonIsOn = !this.buttonIsOn;
    this.log(`${this.name}: SQS Button state change. New state is ${this.buttonIsOn}`);
    this.service.getCharacteristic(Characteristic.On).setValue(this.buttonIsOn);
  },

  identify: function(callback) {
    this.log("[" + this.name + "] Identify requested!");
    callback(); // success
  },

  getServices: function() {
    //get the services this accessory supports
    //this is were we setup the button, but if it was, eg, a fan, you'd make a fan here.

    var services = [];

    var informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Manufacturer, 'Fargo Bose Security');

    var switchService = new Service.Switch(this.accessory.name);
    switchService
      .getCharacteristic(Characteristic.On)
      .on('get', this.getSPState.bind(this))
      .on('set', this.setSPState.bind(this));

    informationService
      .setCharacteristic(Characteristic.Model, 'QueueButton')
      .setCharacteristic(Characteristic.SerialNumber, '1.0');

    services.push(switchService, informationService);

    //keep the service, so we can turn it on/off later.
    this.service = switchService;

    return services;
  },

  getSPState: function(callback) {
    //homekit calling into us to get the state
    this.log(`${this.name}: Get State: ${this.buttonIsOn}`);
    callback(null, this.buttonIsOn);
  },

  setSPState: function(state, callback) {

    //homekit calling into us to set the state. state is 1 or 0
    if (state) {
      this.buttonIsOn = true;
    } else {
      this.buttonIsOn = false;
    }
    this.log(`${this.name}: Set State to ${this.buttonIsOn}`);
    callback(null, this.buttonIsOn);

  }
}
